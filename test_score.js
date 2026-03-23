const query = "mechanic";
const qLower = query.toLowerCase().trim();
const STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'in', 'at', 'for', 'of', 'to', 'is', 'on', 'jobs', 'job', 'near', 'me']);
const words = qLower.split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w));
const tokens = new Set([qLower, ...words]);
const tokenArr = [...tokens];
console.log("Tokens for 'mechanic':", tokenArr);

const jobs = [
    { title: "Co-CEO & Partner: Scaling a Global Real Estate Data Platform", description: "mechanic? no... looking for a CEO. Or does it have 'me'?" },
    { title: "AWS Canada Partner Leader, AMER Partner Management", description: "AWS stuff" },
    { title: "Employee Relations Manager", description: "Amazon.com Employee Relations Manager" },
    { title: "CNC Machinist", description: "Zaber Technologies CNC Machinist" }
];

jobs.forEach(j => {
    let score = 0;
    const t = j.title.toLowerCase();
    const d = j.description.toLowerCase();
    for (const tok of tokenArr) {
        if (t.includes(tok)) score += tok.includes(' ') ? 3 : 2;
        else if (d.includes(tok)) score += 1;
    }
    console.log(`Title: ${j.title} | Score: ${score}`);
});
