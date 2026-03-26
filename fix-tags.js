const fs = require('fs');
const path = require('path');

const postsDir = path.join(__dirname, '_posts');

// Map: for each post, define proper categories (broad) and tags (specific)
const postTagMap = {
  '2025-07-06': { categories: ['DevOps', 'Cloud'], tags: ['docker', 'aws', 'bedrock', 'ai', 'ollama', 'openwebui', 'ubuntu', 'linux'] },
  '2025-05-04': { categories: ['DevOps', 'Cloud'], tags: ['proxmox', 'aws', 's3', 's3fs', 'linux', 'backup'] },
  '2025-01-11': { categories: ['Homelab', 'Networking'], tags: ['linux', 'proxmox', 'networking', 'bridge'] },
  '2025-01-07': { categories: ['Automation', 'Networking'], tags: ['cloudflare', 'dns', 'linux', 'bash', 'api'] },
  '2024-05-27': { categories: ['Homelab', 'DevOps'], tags: ['proxmox', 'cloud-init', 'linux', 'automation', 'ubuntu'] },
  '2024-05-07-building': { categories: ['Homelab', 'Code'], tags: ['raspberry-pi', 'python', 'flask', 'prometheus', 'grafana', 'monitoring', 'iot'] },
  '2024-04-30': { categories: ['Homelab'], tags: ['proxmox', 'lvm', 'linux', 'troubleshooting'] },
  '2024-04-28': { categories: ['Automation', 'DevOps'], tags: ['semaphore', 'ansible', 'linux', 'ci-cd'] },
  '2024-04-24': { categories: ['Homelab'], tags: ['linux', 'ubuntu', 'storage', 'disks', 'fstab'] },
  '2024-04-22-limit': { categories: ['Homelab'], tags: ['unifi', 'linux', 'networking', 'java'] },
  '2024-04-22-extend': { categories: ['Homelab'], tags: ['raspberry-pi', 'linux', 'storage', 'sd-card'] },
  '2024-03-23-automatically': { categories: ['Automation', 'Security'], tags: ['fail2ban', 'ansible', 'linux', 'devops'] },
  '2024-03-23-passwordless': { categories: ['Automation', 'DevOps'], tags: ['ansible', 'ssh', 'linux', 'security', 'patching'] },
  '2024-03-14': { categories: ['Homelab', 'Networking'], tags: ['unifi', 'ubiquiti', 'docker', 'tailscale', 'vpn', 'remote-access'] },
  '2024-03-13': { categories: ['Security', 'Networking'], tags: ['tailscale', 'vpn', 'acl', 'remote-access', 'privacy'] },
  '2024-03-07': { categories: ['DevOps'], tags: ['ansible', 'study', 'books'] },
  '2024-03-03': { categories: ['Homelab'], tags: ['linux', 'networking', 'docker', 'proxmox', 'monitoring', 'automation'] },
  '2024-01-23': { categories: ['Code', 'IoT'], tags: ['esp32', 'arduino', 'email', 'smtp', 'ifs', 'erp'] },
  '2024-01-21-sql': { categories: ['Code'], tags: ['sql', 'database', 'oracle', 'reference'] },
};

const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.md'));

for (const file of files) {
  const filePath = path.join(postsDir, file);
  let content = fs.readFileSync(filePath, 'utf-8');

  // Find matching key
  let matchKey = null;
  for (const key of Object.keys(postTagMap)) {
    if (file.includes(key)) {
      matchKey = key;
      break;
    }
  }

  if (!matchKey) {
    console.log(`  [SKIP] No mapping for: ${file}`);
    continue;
  }

  const { categories, tags } = postTagMap[matchKey];

  // Replace categories line
  const catStr = `categories: [${categories.map(c => `"${c}"`).join(', ')}]`;
  const tagStr = `tags: [${tags.map(t => `"${t}"`).join(', ')}]`;

  // Replace existing categories line and add tags
  content = content.replace(
    /^categories: \[.*\]$/m,
    `${catStr}\ntags: ${tagStr.replace('tags: ', '')}`
  );

  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`  [UPDATED] ${file} -> ${categories.join(', ')} | ${tags.join(', ')}`);
}

console.log('\nDone!');
