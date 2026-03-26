const fs = require('fs');
const path = require('path');

const postsDir = path.join(__dirname, '_posts');
const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.md'));

// Patterns to detect language from code content
function detectLanguage(code) {
  const trimmed = code.trim();
  
  // Bash/shell patterns
  if (/^(sudo |apt |docker |git |curl |wget |ssh |nano |chmod |chown |systemctl |service |mkdir |cd |ls |cat |echo |cp |mv |rm |tar |grep |pip |npm |ansible|qm |crontab|touch |export )/.test(trimmed)) return 'bash';
  if (/^\$ /.test(trimmed)) return 'bash';
  if (/^#!\/bin\/(bash|sh)/.test(trimmed)) return 'bash';
  if (/^# (Update|Install|Create|Add|Set|Run|Navigate|Clone|Build|Pull|Stop|Start|Backup|Download)/.test(trimmed)) return 'bash';
  if (/\|\s*(grep|awk|sed|sort|head|tail|wc)/.test(trimmed)) return 'bash';
  if (/sudo\s+(apt|yum|dnf|systemctl|ufw)/.test(trimmed)) return 'bash';
  if (/docker\s+(run|ps|logs|exec|stop|rm|build|pull|push)/.test(trimmed)) return 'bash';
  
  // Python patterns
  if (/^(import |from |def |class |if __name__|#!\/usr\/bin\/env python)/.test(trimmed)) return 'python';
  if (/\bprint\(/.test(trimmed) && /\bdef /.test(trimmed)) return 'python';
  if (/@app\.(route|get|post)/.test(trimmed)) return 'python';
  if (/flask|Flask|Gauge|prometheus/.test(trimmed)) return 'python';
  
  // YAML patterns
  if (/^---\s*$/.test(trimmed.split('\n')[0]) && /^\w+:/.test(trimmed.split('\n')[1] || '')) return 'yaml';
  if (/^- name:/.test(trimmed)) return 'yaml';
  if (/^(global|scrape_configs|hosts):/.test(trimmed)) return 'yaml';
  
  // SQL patterns
  if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH)\s/i.test(trimmed)) return 'sql';
  if (/\b(FROM|WHERE|JOIN|GROUP BY|ORDER BY|HAVING)\b/i.test(trimmed) && /\bSELECT\b/i.test(trimmed)) return 'sql';
  if (/select .* from /i.test(trimmed)) return 'sql';
  
  // JSON patterns
  if (/^\{[\s\n]+"/.test(trimmed) || /^\[[\s\n]+\{/.test(trimmed)) return 'json';
  
  // C/Arduino patterns  
  if (/^#include\s*</.test(trimmed)) return 'cpp';
  if (/void\s+(setup|loop)\s*\(\)/.test(trimmed)) return 'cpp';
  if (/Serial\.begin/.test(trimmed)) return 'cpp';
  
  // Network config patterns
  if (/^(iface|auto|bridge-ports)\s/.test(trimmed)) return 'text';
  if (/^(PermitRootLogin|PasswordAuthentication)/.test(trimmed)) return 'text';
  
  // Ansible playbook
  if (/ansible\.builtin\./.test(trimmed)) return 'yaml';
  if (/become:\s*true/.test(trimmed)) return 'yaml';

  // Cron
  if (/^\*\/?\d+\s+\*/.test(trimmed) || /^@reboot/.test(trimmed)) return 'bash';
  
  // Error messages / log output
  if (/^(Error|WARNING|INFO|DEBUG|FATAL)/.test(trimmed)) return 'text';
  if (/^(Browser|File |POST |GET )/.test(trimmed)) return 'text';
  if (/ValidationException/.test(trimmed)) return 'text';
  
  return null; // Can't detect
}

let totalFixed = 0;
let totalSkipped = 0;

for (const file of files) {
  const filePath = path.join(postsDir, file);
  let content = fs.readFileSync(filePath, 'utf-8');
  let modified = false;
  
  // Match bare code fences (``` without language)
  content = content.replace(/^```\s*\n([\s\S]*?)^```/gm, (match, code) => {
    // Check if it already has a language on the opening fence
    if (/^```\w/.test(match)) return match;
    
    const lang = detectLanguage(code);
    if (lang) {
      totalFixed++;
      modified = true;
      return '```' + lang + '\n' + code + '```';
    }
    totalSkipped++;
    return match;
  });
  
  if (modified) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`  [UPDATED] ${file}`);
  }
}

console.log(`\nDone! Fixed ${totalFixed} code blocks, skipped ${totalSkipped}`);
