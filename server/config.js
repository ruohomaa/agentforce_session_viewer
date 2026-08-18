import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(__dirname, '..', '.dc-config.json')

let store = null

async function load() {
  if (store) return store
  try {
    store = JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
  } catch {
    store = {}
  }
  return store
}

async function save() {
  await writeFile(CONFIG_PATH, JSON.stringify(store, null, 2), 'utf8')
}

// orgAlias → { consumerKey, privateKey (PEM or file path), loginUrl, username }
export async function getOrgConfig(orgAlias) {
  const s = await load()
  return s[orgAlias] || null
}

export async function setOrgConfig(orgAlias, cfg) {
  await load()
  store[orgAlias] = cfg
  await save()
}

export async function deleteOrgConfig(orgAlias) {
  await load()
  delete store[orgAlias]
  await save()
}

export async function getAllConfigs() {
  return load()
}
