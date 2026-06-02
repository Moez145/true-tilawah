// backend/src/services/tajweed.service.js
const prisma = require("../models/prismaClient");

const cache = new Map(); // ruleName -> { id, ruleCode, severity }

async function getRuleByName(ruleName) {
  if (!ruleName) return null;
  if (cache.has(ruleName)) return cache.get(ruleName);
  const rule = await prisma.tajweedRule.findUnique({
    where: { ruleName },
    select: { id: true, ruleCode: true, severity: true },
  });
  if (rule) cache.set(ruleName, rule);
  return rule;
}

function clearCache() {
  cache.clear();
}

module.exports = { getRuleByName, clearCache };
