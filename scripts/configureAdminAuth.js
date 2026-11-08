const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const dotenv = require('dotenv');

const envPath = path.join(__dirname, '..', '.env');
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const config = dotenv.parse(existing);
if (config.JWT_SECRET?.trim() || process.env.JWT_SECRET?.trim()) {
    console.log('JWT_SECRET is already configured; no changes made.');
} else {
    const secret = randomBytes(48).toString('hex');
    const lines = existing.split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?JWT_SECRET\s*=/.test(line));
    const content = `${lines.join('\n').trimEnd()}\n\n# Private JWT signing key for user and admin sessions.\nJWT_SECRET=${secret}\n`;
    fs.writeFileSync(envPath, content, { mode: 0o600 });
    console.log('Generated JWT_SECRET in the backend .env. Restart the backend to apply it.');
}
