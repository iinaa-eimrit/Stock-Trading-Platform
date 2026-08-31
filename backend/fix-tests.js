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
  
  // engine.placeOrder({ ... }) -> engine.processCommand({ type: 'PLACE_ORDER', timestamp: Date.now(), ... })
  content = content.replace(/engine(\w*)\.placeOrder\(\s*\{/g, "engine$1.processCommand({ type: 'PLACE_ORDER', timestamp: Date.now(),");
  
  // Replace type: 'limit' etc. with orderType: 'limit'
  content = content.replace(/type:\s*('limit'|'market'|'ioc'|type)/g, "orderType: $1");

  // fix wrapper functions
  content = content.replace(/type: OrderType/g, "orderType: OrderType");
  content = content.replace(/orderType: OrderType,\s*priceTicks/g, "orderType: OrderType, priceTicks");

  // engine.cancelOrder('some-id') -> engine.processCommand({ type: 'CANCEL_ORDER', market: 'ETH_USDC', userId: 'u1', orderId: 'some-id' })
  // In tests, they mostly do engine.cancelOrder(orderId)
  content = content.replace(/engine(\w*)\.cancelOrder\(([^)]+)\)/g, "engine$1.processCommand({ type: 'CANCEL_ORDER', market: 'ETH_USDC', userId: 'u1', orderId: $2 })");

  fs.writeFileSync(file, content);
}
console.log('Fixed tests');
