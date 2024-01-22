const { createPool } = require("mysql")
const dotenv = require("dotenv").config()

const pool = createPool({
    port: 3306,
    host: "localhost",
    user: "root",
    password: process.env.MYSQL_PASSWORD,
    database: "discord",
    connectionLimit: 1
})

module.exports = pool;