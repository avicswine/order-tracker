import axios from 'axios'

async function main() {
  const senderCnpj = '56633474000125' // EQUIPAGE sem formatação
  const nfNumber = '19'               // sem zeros
  const tenant = 'trdtransportes'

  console.log(`Resposta bruta da API Senior — NF ${nfNumber} / CNPJ ${senderCnpj}\n`)

  const response = await axios.post(
    'https://platform.senior.com.br/t/senior.com.br/bridge/1.0/anonymous/rest/tms/tck/actions/externalTenantConsultaTracking',
    { inscricaoFiscal: senderCnpj, documento: nfNumber },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant': tenant,
        'X-TenantDomain': `${tenant}.senior.com.br`,
      },
      timeout: 15000,
    }
  )
  console.log(JSON.stringify(response.data, null, 2))
}
main().catch(e => { console.error(e); process.exit(1) })
