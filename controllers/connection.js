const connectionReady = (cb = () =>{}) => {
    console.log('O serviço está ativo!')
    console.log('Estamos prontos para receber e enviar mensagens!');
    cb()
}

/** Como remover o arquivo session.json **/
const connectionLost = (cb = () =>{}) => {
    console.log('Erro de sessão: precesamos gerar novo QRCode.');
    cb()
}


module.exports = {connectionReady, connectionLost}