import fs from 'fs';
import path from 'path';

const schemaPaths = [
  'prisma/schema.prisma',
  'apps/api/prisma/schema.prisma',
  'apps/worker/prisma/schema.prisma'
];

schemaPaths.forEach(schemaPath => {
  const absolutePath = path.resolve(schemaPath);
  if (!fs.existsSync(absolutePath)) {
    console.log(`Schema file not found at: ${absolutePath}`);
    return;
  }

  let content = fs.readFileSync(absolutePath, 'utf8');

  // Replace provider
  content = content.replace(/provider\s*=\s*"postgresql"/g, 'provider = "sqlite"');

  // Remove DB specific type annotations
  content = content.replace(/@db\.Decimal\([^)]*\)/g, '');
  content = content.replace(/@db\.Date/g, '');

  // Convert Json fields to String
  content = content.replace(/\bJson\b/g, 'String');

  // Replace enums with String types
  content = content.replace(/\brole\s+UserRole\b/g, 'role String');
  content = content.replace(/\bkycStatus\s+KycStatus\b/g, 'kycStatus String');
  content = content.replace(/\briskTolerance\s+RiskTolerance\b/g, 'riskTolerance String');
  content = content.replace(/\btype\s+TransactionType\b/g, 'type String');
  content = content.replace(/\bstatus\s+StrategyStatus\b/g, 'status String');
  content = content.replace(/\bstatus\s+RecommendationStatus\b/g, 'status String');
  content = content.replace(/\baction\s+RecommendationAction\b/g, 'action String');

  // Add quotes to defaults for strings that were enums
  content = content.replace(/@default\(PENDING\)/g, '@default("PENDING")');
  content = content.replace(/@default\(BACKTESTING\)/g, '@default("BACKTESTING")');

  // Remove the actual enum blocks
  content = content.replace(/enum\s+\w+\s*\{[^}]*\}/gs, '');

  fs.writeFileSync(absolutePath, content, 'utf8');
  console.log(`Successfully converted schema with SQLite defaults: ${schemaPath}`);
});
