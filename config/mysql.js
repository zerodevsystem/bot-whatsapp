const mysql      = require('mysql');
const connection = mysql.createConnection({
  host     : process.env.SQL_HOST || 'localhost',
  user     : process.env.SQL_USER || 'me',
  password : process.env.SQL_PASS || '',
  database : process.env.SQL_DATABASE || 'my_db'
});

const connect = () => connection.connect(function(err) {
    if (err) {
        console.error('Erro: ' + err.stack + ' Não foi possível conectar na base de dados');
        return;
    }

    console.log('Coexão com a base de dados MySQL: bem sucessida.')
});

module.exports = {connect, connection}