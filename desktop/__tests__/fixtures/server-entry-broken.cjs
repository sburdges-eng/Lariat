// Deliberately throws at module load — used by crash-recovery integration test.
console.error('[broken-entry] about to throw');
throw new Error('intentional crash for crash-recovery test');
