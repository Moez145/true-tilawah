// backend/prisma/seed/tajweedRules.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const RULES = [
  {
    ruleName: "Qalqala",
    ruleCode: "QAL",
    description: "Echo/bounce sound on ق ط ب ج د when sukoon.",
    severity: "MEDIUM",
  },
  {
    ruleName: "Madd",
    ruleCode: "MAD",
    description: "Elongation of vowels (2 to 6 counts).",
    severity: "HIGH",
  },
  {
    ruleName: "Ghunna",
    ruleCode: "GHN",
    description: "Nasalisation on Noon/Meem with shadda for 2 counts.",
    severity: "MEDIUM",
  },
];

async function main() {
  for (const rule of RULES) {
    await prisma.tajweedRule.upsert({
      where: { ruleName: rule.ruleName },
      update: {
        ruleCode: rule.ruleCode,
        description: rule.description,
        severity: rule.severity,
      },
      create: rule,
    });
    console.log(`upserted ${rule.ruleName}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
