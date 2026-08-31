const fs = require('fs');
const path = require('path');

const files = [
  'src/engine/matching-engine.matching.spec.ts',
  'src/engine/matching-engine.properties.spec.ts',
  'src/engine/matching-engine.replay.spec.ts',
  'src/engine/matching-engine.spec.ts',
  'src/engine/matching-engine.deterministic.spec.ts',
  'benchmarks/engine.bench.ts'
];

for (const f of files) {
  const file = path.join(__dirname, f);
  if (!fs.existsSync(file)) continue;

  let content = fs.readFileSync(file, 'utf8');

  // Add import if not present
  if (!content.includes('import { placeOrder, cancelOrder }')) {
    content = "import { placeOrder, cancelOrder } from './test-helpers';\n" + content;
  }
  if (!content.includes('import { placeOrder, cancelOrder } from \'../engine/test-helpers\'') && f.includes('benchmarks')) {
    content = content.replace("import { placeOrder, cancelOrder } from './test-helpers';\n", "import { placeOrder, cancelOrder } from '../src/engine/test-helpers';\n");
  }

  // Reverse the mangled processCommand back to placeOrder(engine, ...)
  // engine.processCommand({ type: 'PLACE_ORDER', timestamp: Date.now(), ... })
  content = content.replace(/engine(\w*)\.processCommand\(\{ type: 'PLACE_ORDER', timestamp: Date\.now\(\),\s*/g, 'placeOrder(engine$1, { ');
  
  // orderType: 'limit' -> type: 'limit' (or keep orderType since the helper takes orderType)
  // Actually, helper takes orderType, so it's fine to leave it.
  
  // engine.processCommand({ type: 'CANCEL_ORDER', market: 'ETH_USDC', userId: 'u1', orderId: 'some-id' })
  // back to cancelOrder(engine, 'some-id')
  content = content.replace(/engine(\w*)\.processCommand\(\{ type: 'CANCEL_ORDER', market: '[^']+', userId: '[^']+', orderId: ([^\}]+) \}\)/g, 'cancelOrder(engine$1, $2)');

  fs.writeFileSync(file, content);
}
console.log('Restored tests with helpers');
