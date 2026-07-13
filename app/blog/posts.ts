export const posts = [
  {
    slug: "brewing-castano-at-home",
    tag: "Brewing Tips",
    title: "How to Brew Castano Like You Mean It",
    excerpt:
      "Grind size, water temperature and timing — the small details that separate a good cup from a great one.",
    body: "Great coffee starts long before the first sip. For Castano, we recommend a 1:16 coffee-to-water ratio, water just off the boil (around 94°C), and a grind matched to your brew method — coarse for French press, medium for pour-over, fine for espresso. Give it the attention it deserves.",
  },
  {
    slug: "origin-story-brazil-honduras",
    tag: "Origin",
    title: "From Brazil to Honduras: Sourcing Castano",
    excerpt:
      "A look at the farms and the people behind the beans that make Castano what it is.",
    body: "Castano is a blend of beans from Brazil, Indonesia, India and Honduras — each chosen for a specific role in the final cup. Brazil brings body and sweetness, Indonesia brings depth, India brings spice, and Honduras rounds it out with bright acidity.",
  },
  {
    slug: "starting-with-coffee",
    tag: "Brand",
    title: "Starting with Coffee. Not Stopping There.",
    excerpt:
      "Why ZUNO began with a bag of coffee — and why it won't end there.",
    body: "ZUNO started with two friends who wanted to create something of their own. Coffee was the first chapter, not the whole story. Quality, design and community are what matter — the category is secondary.",
  },
];

export function getPost(slug: string) {
  return posts.find((p) => p.slug === slug);
}
