/**
 * ⚡⚡⚡ Declaração das bibliotecas e das constantes ⚡⚡⚡
 */

require('dotenv').config()
const fs = require('fs');
const readline = require('readline');
const pathFrantz = "./arquivoWhatsapp.txt";
const express = require('express');
const cors = require('cors')
const qrcode = require('qrcode-terminal');
const { Client, LegacySessionAuth, LocalAuth } = require('whatsapp-web.js');
const mysqlConnection = require('./config/mysql')
const { middlewareClient } = require('./middleware/client')
const { generateImage, cleanNumber, checkEnvFile, createClient } = require('./controllers/handle')
const { connectionReady, connectionLost } = require('./controllers/connection')
const { saveMedia } = require('./controllers/save')
const { getMessages, responseMessages, bothResponse } = require('./controllers/flows')
const { sendMedia, sendMessage, lastTrigger, sendMessageButton, readChat } = require('./controllers/send');
const { Q } = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');

const app = express();
app.use(cors())
app.use(express.json())
const MULTI_DEVICE = process.env.MULTI_DEVICE || 'false';
const server = require('http').Server(app)
const io = require('socket.io')(server, {
    cors: {
        origins: ['http://localhost:4200']
    }
})
let qtd = 0;
let socketEvents = { sendQR: () => { }, sendStatus: () => { } };

io.on('connection', (socket) => {
    const CHANNEL = 'main-channel';
    socket.join(CHANNEL);
    socketEvents = require('./controllers/socket')(socket)
    console.log('Conectado.')
})

app.use('/', require('./routes/web'))

const port = process.env.PORT || 3000
const SESSION_FILE_PATH = './session.json';

var client;
var sessionData;

/** Escutando mensagens **/
const listenMessage = () => client.on('message', async msg => {
    const { from, body, hasMedia } = msg;

    /** Não respoder mensagens de broadcast. **/
    if (from === 'status@broadcast') {
        return
    }

    message = body.toLowerCase();
    console.log('Mensagem', message)
    const number = cleanNumber(from)
    await readChat(number, message)

    /** Salva o arquivo multimídia a ser enviado na pastas {media} **/
    if (process.env.SAVE_MEDIA && hasMedia) {
        const media = await msg.downloadMedia();
        saveMedia(media);
    }

    /** Incializando o dialogflow **/
    if (process.env.DATABASE === 'dialogflow') {
        const response = await bothResponse(message);
        await sendMessage(client, from, response.replyMessage);
        if (response.media) {
            sendMedia(client, from, response.media);
        }
        return
    }


    /** 
     * Inserir procedimentos para gravar as mensagens recebidas no Banco de Dados 
     **/


    const lastStep = await lastTrigger(from) || null;
    if (lastStep) {
        const response = await responseMessages(lastStep)
        await sendMessage(client, from, response.replyMessage);
    }

    // /** Enviando botões **/
    //     const { sendMessageButton } = require('./controllers/send')

    //     await sendMessageButton(
    //         {
    //             "title":"Data Tech:",
    //             "message":"Consultoria e Projetos de Big Data",
    //             "footer":"Acesse nossas redes sociais:",
    //             "buttons":[
    //                 {"body":"😎 Facebook"},
    //                 {"body":"👉 Instagram"},
    //                 {"body":"😁 Site: http://fabiolinhares.com.br"}
    //             ]
    //         }
    //     )

    /** Responda de acordo com as palavras chaves **/
    const step = await getMessages(message);

    if (step) {
        const response = await responseMessages(step);

        await sendMessage(client, from, response.replyMessage, response.trigger);
        if (response.hasOwnProperty('actions')) {
            const { actions } = response;
            await sendMessageButton(client, from, null, actions);
            return
        }

        if (!response.delay && response.media) {
            sendMedia(client, from, response.media);
        }
        if (response.delay && response.media) {
            setTimeout(() => {
                sendMedia(client, from, response.media);
            }, response.delay)
        }
        return
    }

    //Si quieres tener un mensaje por defecto
    if (process.env.DEFAULT_MESSAGE === 'true') {
        const response = await responseMessages('DEFAULT')
        await sendMessage(client, from, response.replyMessage, response.trigger);

        /**
         * Si quieres enviar botones
         */
        if (response.hasOwnProperty('actions')) {
            const { actions } = response;
            await sendMessageButton(client, from, null, actions);
        }
        return
    }
});

/**Temos uma sessão salva: não precisaremos scanear o QRCode. **/
const withSession = () => {
    console.log(`Reconectado.`)
    sessionData = require(SESSION_FILE_PATH);
    client = new Client(createClient(sessionData, true));

    client.on('ready', () => {
        connectionReady()
        listenMessage()
        loadRoutes(client);
        socketEvents.sendStatus()

    });

    client.on('auth_failure', () => connectionLost())

    client.initialize();
}

/** Não temos uma sessão salva: vamos gerar o QRCode. **/
const withOutSession = () => {
    console.log(['Por favor, utilize o QRCode abaixo para conectar seu whatsapp à aplicação',].join('\n'));

    client = new Client(createClient());

    client.on('qr', qr => generateImage(qr, () => {
        qrcode.generate(qr, { small: true });
        console.log(`Caso prefira, acesse o QRCode neste link: http://localhost:${port}/qr`)
        socketEvents.sendQR(qr)
    }))

    client.on('ready', (a) => {

        
        connectionReady()
        listenMessage()
        loadRoutes(client);
        socketEvents.sendStatus(client)
    });

    client.on('auth_failure', (e) => {
        // console.log(e)
        // connectionLost()
    });

    client.on('authenticated', (session) => {
        sessionData = session;
        if (sessionData) {
            fs.writeFile(SESSION_FILE_PATH, JSON.stringify(session), function (err) {
                if (err) {
                    console.log(`Erro:`, err, `\nNão foi possível conectar.`);
                }
            });
        }
    });

    client.initialize();
}

/** Cargamos rutas de express **/
const loadRoutes = (client) => {
    app.use('/api/', middlewareClient(client), require('./routes/api'))

}

/** Se tem arquivo executa withSession senão, withOutSession. **/
(fs.existsSync(SESSION_FILE_PATH) && MULTI_DEVICE === 'false') ? withSession() : withOutSession();

/** Conectando ao Mysql **/
if (process.env.DATABASE === 'mysql') {
    mysqlConnection.connect()
}


server.listen(port, () => {
    console.log(`Este serviço utiliza a porta ${port}`);

    const rl = readline.createInterface({
        input: fs.createReadStream(pathFrantz),
        crlfDelay: Infinity
    });
    var numero = 0;
    var mensagem = "";
    rl.on('line', linha => {
        let campos = linha.split(','); // campos delimitados por vírgula
        numero = campos[0];
        mensagem = campos[1];
        console.log( "Telefone: " + numero + " Mensagem:" +  mensagem );
        //console.log( `Inscrição: ${campos[1]} - Evento: ${campos[2]} - Nome: ${campos[0]}` );
        //sendMessage(client, ${campos[0]}, arr[i].replace(',', ""), null);
    });
 

})
checkEnvFile();

