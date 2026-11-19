import fs from 'fs'
import path from 'path'
import axios from 'axios'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TOKENS_FILE = path.join(__dirname, '../../.bling-tokens.json')
const tokens: Record<string, { access_token: string }> = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'))

async function main() {
  const r = await axios.get('https://api.bling.com.br/Api/v3/nfe?pagina=1&limite=2', {
    headers: { Authorization: `Bearer ${tokens['avic'].access_token}` }
  })
  // Mostra todos os campos de uma NF
  console.log(JSON.stringify(r.data?.data?.[0], null, 2))
}
main().catch(console.error)
