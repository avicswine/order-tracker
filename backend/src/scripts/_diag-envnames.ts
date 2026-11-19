// Lista só os NOMES das variáveis de banco (nunca os valores — são credenciais).
const nomes = Object.keys(process.env)
  .filter((k) => /DATABASE|POSTGRES|^PG/i.test(k))
  .sort()
console.log(nomes.length ? nomes.join('\n') : '(nenhuma)')
