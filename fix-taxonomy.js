const fs = require('fs');
const path = require('path');

const postsDir = path.join(__dirname, '_posts');

// Consistent taxonomy:
// Categories (broad, max 2): Homelab, DevOps, Networking, Security, Code, Cloud
// Tags (specific, 3-6 per post): lowercase, hyphenated
const taxonomy = {
  '2024-01-21-sql': {
    categories: ['Code'],
    tags: ['sql', 'database', 'reference']
  },
  '2024-01-23-esp32': {
    categories: ['Code', 'Homelab'],
    tags: ['esp32', 'arduino', 'smtp', 'iot', 'erp']
  },
  '2024-03-03-homelab-ideas': {
    categories: ['Homelab'],
    tags: ['linux', 'docker', 'proxmox', 'networking', 'monitoring', 'self-hosting']
  },
  '2024-03-07-jeff-gerling': {
    categories: ['DevOps'],
    tags: ['ansible', 'automation', 'learning']
  },
  '2024-03-13-enhancing': {
    categories: ['Networking', 'Security'],
    tags: ['tailscale', 'vpn', 'acl', 'remote-access']
  },
  '2024-03-14-upgrading': {
    categories: ['Homelab', 'Networking'],
    tags: ['unifi', 'ubiquiti', 'tailscale', 'vpn', 'wifi']
  },
  '2024-03-23-automatically': {
    categories: ['DevOps', 'Security'],
    tags: ['fail2ban', 'ansible', 'linux', 'automation']
  },
  '2024-03-23-passwordless': {
    categories: ['DevOps'],
    tags: ['ansible', 'ssh', 'linux', 'automation', 'patching']
  },
  '2024-04-22-extend': {
    categories: ['Homelab'],
    tags: ['raspberry-pi', 'linux', 'storage', 'sd-card', 'zram']
  },
  '2024-04-22-limit': {
    categories: ['Homelab'],
    tags: ['unifi', 'linux', 'java', 'memory']
  },
  '2024-04-24-how-to-format': {
    categories: ['Homelab'],
    tags: ['linux', 'ubuntu', 'storage', 'fstab']
  },
  '2024-04-28-semaphore': {
    categories: ['DevOps'],
    tags: ['semaphore', 'ansible', 'automation', 'ci-cd']
  },
  '2024-04-30-proxmox-activating': {
    categories: ['Homelab'],
    tags: ['proxmox', 'lvm', 'linux', 'troubleshooting']
  },
  '2024-05-07-building': {
    categories: ['Homelab', 'Code'],
    tags: ['raspberry-pi', 'python', 'prometheus', 'grafana', 'monitoring', 'iot']
  },
  '2024-05-27-proxmox-templates': {
    categories: ['Homelab', 'DevOps'],
    tags: ['proxmox', 'cloud-init', 'linux', 'automation']
  },
  '2025-01-07-how-to-update': {
    categories: ['Networking', 'DevOps'],
    tags: ['cloudflare', 'dns', 'bash', 'api', 'automation']
  },
  '2025-01-11-how-to-use-your': {
    categories: ['Homelab', 'Networking'],
    tags: ['linux', 'proxmox', 'networking', 'bridge']
  },
  '2025-05-04-how-to-use-s3': {
    categories: ['Cloud', 'Homelab'],
    tags: ['proxmox', 'aws', 's3', 'backup', 'linux']
  },
  '2025-07-06-setup-guide': {
    categories: ['Cloud', 'DevOps'],
    tags: ['docker', 'aws', 'bedrock', 'ai', 'openwebui', 'linux']
  },
  '2026-03-23-debugging': {
    categories: ['Cloud', 'DevOps'],
    tags: ['docker', 'aws', 'bedrock', 'openwebui', 'python', 'debugging']
  },
  '2026-03-24-bulletproofing': {
    categories: ['Homelab'],
    tags: ['raspberry-pi', 'linux', 'unifi', 'reliability', 'networking']
  },
};

const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.md'));
let updated = 0;

for (const file of files) {
  const filePath = path.join(postsDir, file);
  let content = fs.readFileSync(filePath, 'utf-8');

  // Find matching key
  let matchKey = null;
  for (const key of Object.keys(taxonomy)) {
    if (file.includes(key)) {
      matchKey = key;
      break;
    }
  }

  if (!matchKey) {
    console.log(`  [SKIP] No mapping: ${file}`);
    continue;
  }

  const { categories, tags } = taxonomy[matchKey];
  const catStr = `categories: [${categories.map(c => `"${c}"`).join(', ')}]`;
  const tagStr = `tags: [${tags.map(t => `"${t}"`).join(', ')}]`;

  // Replace categories line
  content = content.replace(/^categories:\s*\[.*\]$/m, catStr);
  // Replace tags line
  content = content.replace(/^tags:\s*\[.*\]$/m, tagStr);

  fs.writeFileSync(filePath, content, 'utf-8');
  updated++;
  console.log(`  [OK] ${file.substring(0, 55)} → ${categories.join(', ')} | ${tags.join(', ')}`);
}

console.log(`\nDone! Updated ${updated} posts.`);
