/**
 * Audit logging system for management actions
 * Stores audit trail of recipe edits, cost updates, and other sensitive operations
 */

import fs from 'fs';
import path from 'path';

const AUDIT_LOG_DIR = path.join(process.cwd(), 'data', 'audit');
const AUDIT_LOG_FILE = path.join(AUDIT_LOG_DIR, 'management-actions.jsonl');

// Ensure audit log directory exists
function ensureAuditDir() {
  if (!fs.existsSync(AUDIT_LOG_DIR)) {
    fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
  }
}

/**
 * Log a management action to the audit trail
 * @param {Object} auditEntry - Audit entry with action, timestamp, user, changes, etc.
 */
export function logAuditAction(auditEntry) {
  try {
    ensureAuditDir();
    
    // Add standard fields
    const entry = {
      ...auditEntry,
      timestamp: auditEntry.timestamp || new Date().toISOString(),
      id: generateAuditId(),
    };

    // Append to JSONL file
    fs.appendFileSync(AUDIT_LOG_FILE, JSON.stringify(entry) + '\n');
    
    return entry;
  } catch (error) {
    console.error('Failed to log audit action:', error);
    throw error;
  }
}

/**
 * Generate unique audit entry ID
 */
function generateAuditId() {
  return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Read recent audit logs
 * @param {number} limit - Number of recent entries to return
 */
export function getRecentAuditLog(limit = 100) {
  try {
    if (!fs.existsSync(AUDIT_LOG_FILE)) {
      return [];
    }

    const content = fs.readFileSync(AUDIT_LOG_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    
    // Get the last `limit` entries
    const entries = lines
      .slice(-limit)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse(); // Most recent first

    return entries;
  } catch (error) {
    console.error('Failed to read audit log:', error);
    return [];
  }
}

/**
 * Get audit log entries for a specific action
 * @param {string} action - The action type to filter by (e.g., 'recipe_edit', 'cost_update')
 */
export function getAuditLogByAction(action) {
  try {
    const recentLogs = getRecentAuditLog(1000); // Get last 1000 entries
    return recentLogs.filter(entry => entry.action === action);
  } catch (error) {
    console.error('Failed to filter audit log:', error);
    return [];
  }
}

/**
 * Get audit log entries for a specific recipe
 * @param {string} slug - Recipe slug
 */
export function getAuditLogForRecipe(slug) {
  try {
    const recentLogs = getRecentAuditLog(500);
    return recentLogs.filter(entry => entry.slug === slug);
  } catch (error) {
    console.error('Failed to get recipe audit log:', error);
    return [];
  }
}

/**
 * Export audit log for compliance/reporting
 * @param {Date} startDate - Start date for export
 * @param {Date} endDate - End date for export
 */
export function exportAuditLog(startDate, endDate) {
  try {
    const recentLogs = getRecentAuditLog(5000);
    
    const filtered = recentLogs.filter(entry => {
      const entryDate = new Date(entry.timestamp);
      return entryDate >= startDate && entryDate <= endDate;
    });

    return filtered;
  } catch (error) {
    console.error('Failed to export audit log:', error);
    return [];
  }
}
