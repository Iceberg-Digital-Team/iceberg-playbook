import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function validateMediaReference(urlOrPath) {
  if (typeof urlOrPath !== 'string') {
    return { valid: false, error: 'Media reference must be a string.' };
  }
  const clean = urlOrPath.trim();
  if (!clean) {
    return { valid: false, error: 'Media reference must not be empty.' };
  }
  if (/^(?:data|javascript):/i.test(clean)) {
    return { valid: false, error: `Insecure media scheme rejected: ${clean}` };
  }
  if (/^assets\/[a-zA-Z0-9_\-./]+$/.test(clean) || /^https:\/\/[^\s]+$/.test(clean)) {
    return { valid: true };
  }
  return { valid: false, error: `Invalid media reference format: ${clean}` };
}

export function validateBootstrapContent(content) {
  const errors = [];

  if (!content || typeof content !== 'object') {
    return { valid: false, errors: ['Content bundle must be an object.'] };
  }

  // 1. Version
  if (!content.version || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(content.version)) {
    errors.push(`Invalid bundle version: ${content.version}`);
  }

  // 2. Playbooks
  if (!Array.isArray(content.playbooks) || content.playbooks.length === 0) {
    errors.push('Bundle must contain at least one Playbook.');
  }

  const playbookKeys = new Set();
  for (const pb of content.playbooks || []) {
    if (!pb.key || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pb.key)) {
      errors.push(`Invalid Playbook key format: "${pb.key}"`);
    } else if (playbookKeys.has(pb.key)) {
      errors.push(`Duplicate Playbook key: "${pb.key}"`);
    } else {
      playbookKeys.add(pb.key);
    }

    if (!pb.name || typeof pb.name !== 'string') errors.push(`Playbook ${pb.key} missing valid name.`);
    if (!pb.code || typeof pb.code !== 'string') errors.push(`Playbook ${pb.key} missing valid code.`);
    if (!pb.description || typeof pb.description !== 'string') errors.push(`Playbook ${pb.key} missing valid description.`);
    if (pb.visibility && !['Internal', 'Public'].includes(pb.visibility)) {
      errors.push(`Playbook ${pb.key} has invalid visibility: ${pb.visibility}`);
    }
  }

  // 3. SOPs
  if (!Array.isArray(content.sops) || content.sops.length === 0) {
    errors.push('Bundle must contain at least one SOP.');
  }

  const sopKeys = new Set();
  const requiredSopFields = [
    'key',
    'playbookKey',
    'title',
    'owner',
    'status',
    'estimatedTime',
    'purpose',
    'whenToUse',
    'requirements',
    'responsibleTeam',
    'checklist',
    'steps',
    'escalationRules',
    'completionCriteria',
    'relatedIssues',
    'relatedGuides',
    'internalNotes',
    'revisionHistory'
  ];

  for (const sop of content.sops || []) {
    for (const field of requiredSopFields) {
      if (sop[field] === undefined || sop[field] === null) {
        errors.push(`SOP "${sop.key || 'unknown'}" missing required field: ${field}`);
      }
    }

    if (!sop.key || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sop.key)) {
      errors.push(`Invalid SOP key format: "${sop.key}"`);
    } else if (sopKeys.has(sop.key)) {
      errors.push(`Duplicate SOP key: "${sop.key}"`);
    } else {
      sopKeys.add(sop.key);
    }

    if (!playbookKeys.has(sop.playbookKey)) {
      errors.push(`SOP "${sop.key}" references nonexistent playbookKey: "${sop.playbookKey}"`);
    }

    if (!['Verified', 'Draft'].includes(sop.status)) {
      errors.push(`SOP "${sop.key}" has invalid status: "${sop.status}". Must be 'Verified' or 'Draft'.`);
    }

    if (!Array.isArray(sop.requirements)) {
      errors.push(`SOP "${sop.key}" requirements must be an array.`);
    }

    if (!Array.isArray(sop.checklist)) {
      errors.push(`SOP "${sop.key}" checklist must be an array.`);
    }

    if (!Array.isArray(sop.steps) || sop.steps.length === 0) {
      errors.push(`SOP "${sop.key}" must contain at least one step.`);
    } else {
      for (const step of sop.steps) {
        if (typeof step.number !== 'number' || step.number < 1) {
          errors.push(`SOP "${sop.key}" step number must be a positive integer.`);
        }
        if (!step.title || typeof step.title !== 'string') {
          errors.push(`SOP "${sop.key}" step ${step.number} missing title.`);
        }
        if (!step.description || typeof step.description !== 'string') {
          errors.push(`SOP "${sop.key}" step ${step.number} missing description.`);
        }

        // Validate optional media fields if present
        for (const mediaField of ['screenshot', 'videoLink', 'pdfReference']) {
          if (step[mediaField]) {
            const check = validateMediaReference(step[mediaField]);
            if (!check.valid) {
              errors.push(`SOP "${sop.key}" step ${step.number} ${mediaField}: ${check.error}`);
            }
          }
        }
      }
    }

    if (!Array.isArray(sop.revisionHistory)) {
      errors.push(`SOP "${sop.key}" revisionHistory must be an array.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// Standalone execution support
if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  const jsonPath = resolve(__dirname, 'default-content.json');
  if (!existsSync(jsonPath)) {
    console.error(`Error: default-content.json not found at ${jsonPath}`);
    process.exit(1);
  }

  const raw = readFileSync(jsonPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`Error parsing default-content.json: ${err.message}`);
    process.exit(1);
  }

  const result = validateBootstrapContent(parsed);
  if (!result.valid) {
    console.error('Validation FAILED:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log(`Validation SUCCESS: ${parsed.playbooks.length} playbook(s), ${parsed.sops.length} SOP(s) validated successfully.`);
}
