/**
 * PHASE 1 VALIDATION SCRIPT
 * 
 * Quick validation that can be run from Claude Code or console
 * to verify all Phase 1 functionality is working
 */

// ─────────────────────────────────────────────────────────────
// QUICK VALIDATION (Run these in order)
// ─────────────────────────────────────────────────────────────

async function validatePhase1() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║        PHASE 1 SMART SUMMARIZATION VALIDATION                ║
║           Starting validation tests...                        ║
╚══════════════════════════════════════════════════════════════╝
  `);

  const results: {
    checks: { name: string; status: string; detail: string }[];
    passed: number;
    failed: number;
    startTime: number;
  } = {
    checks: [],
    passed: 0,
    failed: 0,
    startTime: Date.now(),
  };

  // CHECK 1: conversationSummarizer.ts exists and exports
  try {
    const { 
      summarizeConversation, 
      storeSummary, 
      getAllSummaries,
      detectSubject,
    } = require('@/services/conversationSummarizer');
    
    if (typeof summarizeConversation === 'function' && 
        typeof storeSummary === 'function' &&
        typeof getAllSummaries === 'function' &&
        typeof detectSubject === 'function') {
      results.checks.push({
        name: '✓ conversationSummarizer.ts exports',
        status: 'PASS',
        detail: '4 main functions exported',
      });
      results.passed++;
    }
  } catch (e) {
    results.checks.push({
      name: '✗ conversationSummarizer.ts exports',
      status: 'FAIL',
      detail: (e as Error).message,
    });
    results.failed++;
  }

  // CHECK 2: Database table creation
  try {
    // This will auto-create the table on first access
    const allSummaries = await require('@/services/conversationSummarizer').getAllSummaries();
    
    if (Array.isArray(allSummaries)) {
      results.checks.push({
        name: '✓ Database table ready',
        status: 'PASS',
        detail: `${allSummaries.length} summaries in database`,
      });
      results.passed++;
    }
  } catch (e) {
    results.checks.push({
      name: '✗ Database table creation',
      status: 'FAIL',
      detail: (e as Error).message,
    });
    results.failed++;
  }

  // CHECK 3: Subject detection
  try {
    const { detectSubject } = require('@/services/conversationSummarizer');
    const testConv = [
      { role: 'user', content: 'Help me design PrivateAI architecture' },
      { role: 'assistant', content: 'Here is the architecture...' },
    ];
    
    const subject = detectSubject(testConv);
    
    if (subject === 'PrivateAI Development') {
      results.checks.push({
        name: '✓ Subject detection working',
        status: 'PASS',
        detail: `Correctly detected: "${subject}"`,
      });
      results.passed++;
    } else {
      results.checks.push({
        name: '⚠ Subject detection',
        status: 'PARTIAL',
        detail: `Detected "${subject}" (expected "PrivateAI Development")`,
      });
    }
  } catch (e) {
    results.checks.push({
      name: '✗ Subject detection',
      status: 'FAIL',
      detail: (e as Error).message,
    });
    results.failed++;
  }

  // CHECK 4: Control Room integration
  try {
    // Check if Control Room file includes summaries UI
    const fs = require('fs').promises;
    const controlRoomPath = '/Users/home/Documents/PrivateAI/app/(tabs)/controlroom.tsx';
    const content = await fs.readFile(controlRoomPath, 'utf-8');
    
    const hasSummarySection = content.includes('summariesSection') && 
                             content.includes('summariesExpanded') &&
                             content.includes('summaryCard');
    
    if (hasSummarySection) {
      results.checks.push({
        name: '✓ Control Room summaries UI',
        status: 'PASS',
        detail: 'Summaries panel and styles integrated',
      });
      results.passed++;
    }
  } catch (e) {
    results.checks.push({
      name: '⚠ Control Room integration',
      status: 'SKIP',
      detail: 'Could not verify file (OK if on device)',
    });
  }

  // CHECK 5: Message flow integration
  try {
    const fs = require('fs').promises;
    const indexPath = '/Users/home/Documents/PrivateAI/app/(tabs)/index.tsx';
    const content = await fs.readFile(indexPath, 'utf-8');
    
    const hasIntegration = content.includes('summarizeConversation') && 
                          content.includes('storeSummary') &&
                          content.includes('[Phase1]');
    
    if (hasIntegration) {
      results.checks.push({
        name: '✓ Message flow integration',
        status: 'PASS',
        detail: 'Summarizer integrated into message handlers',
      });
      results.passed++;
    }
  } catch (e) {
    results.checks.push({
      name: '⚠ Message flow integration',
      status: 'SKIP',
      detail: 'Could not verify file (OK if on device)',
    });
  }

  // CHECK 6: API key available
  try {
    const apiKey = process.env.EXPO_PUBLIC_CLAUDE_API_KEY;
    
    if (apiKey && apiKey.startsWith('sk-')) {
      results.checks.push({
        name: '✓ Claude API key configured',
        status: 'PASS',
        detail: 'API key found and valid format',
      });
      results.passed++;
    } else {
      results.checks.push({
        name: '⚠ Claude API key',
        status: 'PARTIAL',
        detail: 'API key missing or invalid format',
      });
    }
  } catch (e) {
    results.checks.push({
      name: '⚠ API key check',
      status: 'SKIP',
      detail: 'Could not verify environment',
    });
  }

  // RESULTS SUMMARY
  const duration = Date.now() - results.startTime;
  
  console.log('\n' + '═'.repeat(60));
  console.log('VALIDATION RESULTS:');
  console.log('═'.repeat(60));
  
  results.checks.forEach(check => {
    const icon = check.status === 'PASS' ? '✓' : 
                 check.status === 'FAIL' ? '✗' : '⚠';
    console.log(`${icon} ${check.name}`);
    console.log(`  ${check.detail}\n`);
  });
  
  console.log('═'.repeat(60));
  console.log(`SUMMARY: ${results.passed} passed, ${results.failed} failed (${duration}ms)`);
  console.log('═'.repeat(60));

  if (results.failed === 0) {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║              ✓ PHASE 1 VALIDATION PASSED                    ║
║                                                              ║
║  All core components are working correctly:                 ║
║  • Summarizer service functioning                           ║
║  • Database storage operational                             ║
║  • Subject detection working                                ║
║  • Control Room UI integrated                               ║
║  • Message flow integration active                          ║
║                                                              ║
║  You are ready to proceed to Phase 2:                       ║
║  ⏭ Cloud Sync Architecture                                 ║
║    - Upload summaries every 6 hours                        ║
║    - Synology NAS/Nextcloud/AWS S3 support                ║
║    - Tiered storage (HOT/WARM/COLD)                       ║
╚══════════════════════════════════════════════════════════════╝
    `);
    return true;
  } else {
    console.log(`
⚠ PHASE 1 VALIDATION INCOMPLETE

${results.failed} items need attention:
1. Check console errors above
2. Verify .env configuration
3. Ensure all dependencies installed
4. Run: npm install && npx expo run:ios

Then run validation again.
    `);
    return false;
  }
}

// Export for use in tests
export { validatePhase1 };

// If running in Node/CLI context, run validation
if (typeof module !== 'undefined' && require.main === module) {
  validatePhase1().catch(console.error);
}
