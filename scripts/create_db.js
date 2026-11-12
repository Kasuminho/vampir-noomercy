const { Client } = require('pg');

async function createDb() {
  const client = new Client({
    host: '216.22.27.248',
    port: 5432,
    user: 'user_sSDpr4',
    password: 'password_ekcC7Z',
    database: 'postgres',
  });
  await client.connect();

  const check = await client.query("SELECT 1 FROM pg_database WHERE datname = 'vampir_noomercy';");
  if (check.rows.length === 0) {
    console.log("Creating database 'vampir_noomercy'...");
    await client.query('CREATE DATABASE vampir_noomercy;');
    console.log("Database 'vampir_noomercy' created successfully!");
  } else {
    console.log("Database 'vampir_noomercy' already exists.");
  }

  await client.end();
}

createDb().catch(console.error);
