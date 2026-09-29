import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { execSync } from 'node:child_process';
import { stdin as input, stdout as output } from 'node:process';

const ROOT_DIR = process.cwd();
const ENV_LOCAL_PATH = path.join(ROOT_DIR, '.env.local');
const ENV_ENC_PATH = path.join(ROOT_DIR, '.env.encrypted');
const ENV_EXAMPLE_PATH = path.join(ROOT_DIR, '.env.example');

const BACKUP_FILES = [
  '.env.local.backup-before-gemini-fix',
  '.env.local.before-alpha-cleanup',
  '.env.local.save',
];

function getCliPassword() {
  const args = process.argv.slice(2);
  const pIndex = args.findIndex((arg) => arg === '--password' || arg === '-p');
  if (pIndex !== -1 && args[pIndex + 1]) {
    return args[pIndex + 1];
  }
  return process.env.SECRET_PASSWORD || null;
}

async function askPassword(promptText = 'Ingrese contraseña: ') {
  const cliPass = getCliPassword();
  if (cliPass) return cliPass;

  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input, output });
    try {
      const answer = await rl.question(promptText);
      return answer.trim();
    } finally {
      rl.close();
    }
  }

  throw new Error(
    'No se proporcionó contraseña. Usa --password <pass> o la variable de entorno SECRET_PASSWORD.'
  );
}

function deriveKey(password, salt, iterations = 100000) {
  return crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha512');
}

function encryptText(plaintext, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return JSON.stringify(
    {
      version: 1,
      cipher: 'aes-256-gcm',
      kdf: 'pbkdf2-sha512',
      iterations: 100000,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      data: encrypted,
    },
    null,
    2
  );
}

function decryptPayload(jsonString, password) {
  const payload = JSON.parse(jsonString);
  if (!payload.salt || !payload.iv || !payload.authTag || !payload.data) {
    throw new Error('El archivo encriptado tiene un formato no válido.');
  }

  const salt = Buffer.from(payload.salt, 'hex');
  const iv = Buffer.from(payload.iv, 'hex');
  const authTag = Buffer.from(payload.authTag, 'hex');
  const key = deriveKey(password, salt, payload.iterations || 100000);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(payload.data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function handleEncrypt() {
  if (!fs.existsSync(ENV_LOCAL_PATH)) {
    console.error(`❌ No se encontró ${ENV_LOCAL_PATH}`);
    process.exit(1);
  }

  const content = fs.readFileSync(ENV_LOCAL_PATH, 'utf8');
  let password = getCliPassword();
  let generated = false;

  if (!password) {
    if (process.stdin.isTTY) {
      password = await askPassword('🔐 Define una contraseña para encriptar las API keys (o presiona Enter para generar una aleatoria): ');
    }
    if (!password) {
      password = crypto.randomBytes(18).toString('base64url');
      generated = true;
    }
  }

  const encryptedJson = encryptText(content, password);
  fs.writeFileSync(ENV_ENC_PATH, encryptedJson, 'utf8');

  console.log('✅ Archivo .env.encrypted generado con éxito.');
  if (generated) {
    console.log('\n============================================================');
    console.log('🔑 CONTRASEÑA GENERADA (Guárdala en un lugar seguro):');
    console.log(`👉 ${password}`);
    console.log('============================================================\n');
  } else {
    console.log('🔒 Cifrado con la contraseña especificada.');
  }
}

async function handleDecrypt() {
  if (!fs.existsSync(ENV_ENC_PATH)) {
    console.error(`❌ No se encontró ${ENV_ENC_PATH}`);
    process.exit(1);
  }

  const password = await askPassword('🔑 Ingresa la contraseña para descifrar: ');
  const encryptedJson = fs.readFileSync(ENV_ENC_PATH, 'utf8');

  try {
    const decrypted = decryptPayload(encryptedJson, password);
    fs.writeFileSync(ENV_LOCAL_PATH, decrypted, 'utf8');
    console.log('✅ Archivo .env.local restaurado con éxito.');
  } catch (err) {
    console.error('❌ Error: Contraseña incorrecta o archivo dañado.');
    process.exit(1);
  }
}

async function handleLock() {
  if (!fs.existsSync(ENV_ENC_PATH)) {
    console.error('❌ Primero debes generar el archivo encriptado ejecutando: npm run secrets:encrypt');
    process.exit(1);
  }

  const password = await askPassword('🔑 Ingresa la contraseña para verificar el archivo encriptado antes de bloquear: ');
  const encryptedJson = fs.readFileSync(ENV_ENC_PATH, 'utf8');

  try {
    decryptPayload(encryptedJson, password);
    console.log('✅ Verificación exitosa: La contraseña descifra correctamente el documento encriptado.');
  } catch {
    console.error('❌ Contraseña inválida. No se eliminaron los archivos por seguridad.');
    process.exit(1);
  }

  // Eliminar .env.local
  if (fs.existsSync(ENV_LOCAL_PATH)) {
    fs.unlinkSync(ENV_LOCAL_PATH);
    console.log('🗑️  .env.local eliminado de forma segura.');
  }

  // Eliminar respaldos viejos
  for (const file of BACKUP_FILES) {
    const full = path.join(ROOT_DIR, file);
    if (fs.existsSync(full)) {
      fs.unlinkSync(full);
      console.log(`🗑️  ${file} eliminado.`);
    }
  }

  console.log('\n✨ Proyecto bloqueado y protegido: Las API keys están ocultas en .env.encrypted.');
  console.log('Ya puedes exportar, comprimir o compartir el proyecto sin exponer credenciales.');
  console.log('Para volver a trabajar localmente, ejecuta: npm run secrets:decrypt');
}

async function handleExport() {
  if (!fs.existsSync(ENV_ENC_PATH)) {
    console.error('❌ No se encontró .env.encrypted. Ejecuta primero: npm run secrets:encrypt');
    process.exit(1);
  }

  const zipName = 'stock-intelligence-clean.zip';
  const zipPath = path.join(ROOT_DIR, zipName);

  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  console.log('📦 Empaquetando proyecto limpio para exportar...');

  try {
    execSync(
      `zip -q -r "${zipName}" . -x "node_modules/*" ".next/*" ".git/*" ".env.local*" "*.zip" "*.tsbuildinfo"`,
      { stdio: 'inherit' }
    );

    // Verificar con unzip que .env.local NO esté dentro
    const list = execSync(`unzip -l "${zipName}"`).toString();
    if (list.includes('.env.local')) {
      fs.unlinkSync(zipPath);
      throw new Error('ALERTA DE SEGURIDAD: .env.local fue incluido en el archivo. Se canceló la exportación.');
    }

    const stats = fs.statSync(zipPath);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

    console.log(`\n🎉 ¡Exportación completada con éxito!`);
    console.log(`📁 Archivo generado: ${zipName} (${sizeMb} MB)`);
    console.log(`📍 Ubicación: ${zipPath}`);
    console.log('\n🔒 Verificación de seguridad:');
    console.log('  ✅ .env.local EXCLUIDO (claves ocultas)');
    console.log('  ✅ node_modules y .next EXCLUIDOS (peso ligero)');
    console.log('  ✅ .env.encrypted INCLUIDO (bóveda protegida con contraseña)');
    console.log('  ✅ .env.example INCLUIDO (plantilla pública)');
  } catch (err) {
    console.error('❌ Error al exportar:', err.message);
    process.exit(1);
  }
}

async function handleStatus() {
  console.log('📋 Estado de configuración de secretos:');
  console.log(` - .env.local:     ${fs.existsSync(ENV_LOCAL_PATH) ? 'Presente (en desarrollo local)' : 'Oculto / Bloqueado'}`);
  console.log(` - .env.encrypted: ${fs.existsSync(ENV_ENC_PATH) ? 'Presente (protegido)' : 'No generado'}`);
  console.log(` - .env.example:   ${fs.existsSync(ENV_EXAMPLE_PATH) ? 'Presente' : 'No encontrado'}`);
}

async function main() {
  const action = process.argv[2] || 'status';

  switch (action) {
    case 'encrypt':
      await handleEncrypt();
      break;
    case 'decrypt':
      await handleDecrypt();
      break;
    case 'lock':
      await handleLock();
      break;
    case 'export':
      await handleExport();
      break;
    case 'status':
      await handleStatus();
      break;
    default:
      console.log('Uso: node scripts/secrets.mjs [encrypt|decrypt|lock|export|status]');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error inesperado:', err.message);
  process.exit(1);
});
