import { fetchBookingsSinceLastSync, fetchExpensesSinceLastSync } from '@/server/integrations/navan';

async function main() {
  console.log('=== Probing Navan API directly ===');
  const bookings = await fetchBookingsSinceLastSync().catch((e) => {
    console.error('bookings fetch threw:', e?.message ?? e);
    return [];
  });
  console.log(`\nBookings returned: ${bookings.length}`);
  if (bookings[0]) {
    console.log('First booking keys:', Object.keys(bookings[0] as object));
    console.log('First booking sample:', JSON.stringify(bookings[0], null, 2).slice(0, 2000));
  }
  const expenses = await fetchExpensesSinceLastSync().catch((e) => {
    console.error('expenses fetch threw:', e?.message ?? e);
    return [];
  });
  console.log(`\nExpenses returned: ${expenses.length}`);
  if (expenses[0]) {
    console.log('First expense keys:', Object.keys(expenses[0] as object));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
