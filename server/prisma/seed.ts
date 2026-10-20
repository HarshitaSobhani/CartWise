import bcrypt from 'bcryptjs';
import { prisma } from '../src/db.js';
import { DEMO_SLUG, dayStart, demoBase, demoPrice } from '../src/adapters/demo.js';
import { ingestObservations } from '../src/services/observations.js';

const CATALOG: [string, string, string, string, Record<string, string>][] = [
  ['Aurora X1 Laptop 14"', 'Northwind', 'Laptops', 'Lightweight 14-inch laptop', { RAM: '16 GB', Storage: '512 GB', Weight: '1.2 kg' }],
  ['Aurora X1 Laptop 16"', 'Northwind', 'Laptops', 'Larger 16-inch variant', { RAM: '32 GB', Storage: '1 TB', Weight: '1.8 kg' }],
  ['Meridian Pro Laptop', 'Contoso', 'Laptops', 'Creator-focused laptop', { RAM: '32 GB', Storage: '1 TB', Weight: '2.0 kg' }],
  ['Pulse Buds Wireless', 'Fabrikam', 'Audio', 'True wireless earbuds', { Battery: '8 h', ANC: 'Yes' }],
  ['Pulse Over-Ear ANC', 'Fabrikam', 'Audio', 'Over-ear noise cancelling headphones', { Battery: '30 h', ANC: 'Yes' }],
  ['Echo Bar Soundbar', 'Contoso', 'Audio', '2.1 channel soundbar', { Channels: '2.1', Power: '120 W' }],
  ['Lumen 55" 4K TV', 'Northwind', 'TVs', '55-inch 4K LED TV', { Panel: 'LED', Refresh: '60 Hz' }],
  ['Lumen 65" OLED TV', 'Northwind', 'TVs', '65-inch OLED TV', { Panel: 'OLED', Refresh: '120 Hz' }],
  ['Orbit Phone S', 'Tailspin', 'Phones', 'Compact smartphone', { Storage: '128 GB', Screen: '6.1 in' }],
  ['Orbit Phone Max', 'Tailspin', 'Phones', 'Large-screen smartphone', { Storage: '256 GB', Screen: '6.8 in' }],
  ['Swift Tablet 11', 'Tailspin', 'Tablets', '11-inch tablet', { Storage: '128 GB', Screen: '11 in' }],
  ['Swift Tablet 13', 'Tailspin', 'Tablets', '13-inch tablet', { Storage: '256 GB', Screen: '13 in' }],
  ['Brew Master Coffee Maker', 'Wide World', 'Kitchen', 'Programmable drip coffee maker', { Capacity: '12 cups' }],
  ['Crisp Air Fryer 5L', 'Wide World', 'Kitchen', '5-litre air fryer', { Capacity: '5 L', Power: '1700 W' }],
  ['Blendr Pro Blender', 'Wide World', 'Kitchen', 'High-speed blender', { Power: '1200 W' }],
  ['Glide Robot Vacuum', 'Adventure Works', 'Home', 'Robot vacuum with mapping', { Runtime: '120 min' }],
  ['Breeze Tower Fan', 'Adventure Works', 'Home', 'Quiet oscillating tower fan', { Speeds: '3' }],
  ['Trail Runner Shoes', 'Litware', 'Sports', 'Lightweight running shoes', { Weight: '260 g' }],
  ['Summit 40L Backpack', 'Litware', 'Sports', 'Hiking backpack', { Capacity: '40 L' }],
  ['Peak Fitness Watch', 'Litware', 'Wearables', 'GPS fitness watch', { Battery: '10 days', GPS: 'Yes' }],
  ['Vista Action Camera', 'Fabrikam', 'Cameras', '4K action camera', { Video: '4K60' }],
  ['Frame Mirrorless Camera', 'Contoso', 'Cameras', 'Entry mirrorless camera', { Sensor: 'APS-C', Megapixels: '24 MP' }],
  ['Desk Pro Standing Desk', 'Adventure Works', 'Office', 'Electric height-adjustable desk', { Width: '140 cm' }],
  ['Ergo Chair Mesh', 'Adventure Works', 'Office', 'Ergonomic mesh office chair', { Adjustable: 'Yes' }],
];

const DAYS = 90;

async function main() {
  const source = await prisma.source.upsert({
    where: { slug: DEMO_SLUG },
    update: {},
    create: { slug: DEMO_SLUG, name: 'CartWise Demo Provider (synthetic)', kind: 'DEMO', isDemo: true },
  });
  const today = dayStart(new Date());
  const products = [];
  for (const [i, [name, brand, category, description, specs]] of CATALOG.entries()) {
    const externalRef = `demo-${String(i + 1).padStart(3, '0')}`;
    const p = await prisma.product.upsert({
      where: { sourceId_externalRef: { sourceId: source.id, externalRef } },
      update: {},
      create: { sourceId: source.id, externalRef, name, brand, category, description: `${description} (demo product)`, specs },
    });
    await prisma.productIdentifier.upsert({ where: { type_value: { type: 'SKU', value: `DEMO-SKU-${externalRef}` } }, update: {}, create: { productId: p.id, type: 'SKU', value: `DEMO-SKU-${externalRef}` } });
    products.push({ p, externalRef });
  }
  const batch = [];
  for (const { p, externalRef } of products) {
    const base = demoBase(externalRef);
    for (let d = DAYS; d >= 0; d--) {
      const day = new Date(today.getTime() - d * 86_400_000);
      batch.push({ productId: p.id, sourceId: source.id, price: demoPrice(externalRef, day.toISOString().slice(0, 10), base), currency: 'USD', observedAt: day, origin: 'DEMO' as const, sourceRef: `demo:${externalRef}:${day.toISOString().slice(0, 10)}` });
    }
  }
  // Two products also have synthetic EUR observations so the currency-mismatch handling is visible.
  for (const { p, externalRef } of products.slice(3, 5)) {
    const base = demoBase(externalRef) * 0.9;
    for (let d = 30; d >= 0; d--) {
      const day = new Date(today.getTime() - d * 86_400_000);
      batch.push({ productId: p.id, sourceId: source.id, price: demoPrice(`eur:${externalRef}`, day.toISOString().slice(0, 10), base), currency: 'EUR', observedAt: day, origin: 'DEMO' as const, sourceRef: `demo-eur:${externalRef}:${day.toISOString().slice(0, 10)}` });
    }
  }
  const { inserted, duplicates } = await ingestObservations(prisma, batch);

  const pw = process.env.SEED_PASSWORD ?? 'CartWise-Demo-2026';
  const hash = await bcrypt.hash(pw, 12);
  await prisma.user.upsert({ where: { email: 'admin@cartwise.local' }, update: {}, create: { email: 'admin@cartwise.local', name: 'Demo Admin', role: 'ADMIN', passwordHash: hash, wishlists: { create: { name: 'My wishlist' } } } });
  await prisma.user.upsert({ where: { email: 'demo@cartwise.local' }, update: {}, create: { email: 'demo@cartwise.local', name: 'Demo Shopper', passwordHash: hash, wishlists: { create: { name: 'My wishlist' } } } });
  console.log(`Seeded ${products.length} demo products; ${inserted.length} new observations (${duplicates} duplicates skipped).`);
  console.log('Demo logins: admin@cartwise.local / demo@cartwise.local (password from SEED_PASSWORD, default in README). All catalog data is synthetic DEMO data.');
}

main().finally(() => prisma.$disconnect());
