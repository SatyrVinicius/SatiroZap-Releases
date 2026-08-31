/**
 * Utility functions for WhatsApp Scheduler
 */

/**
 * Generates a unique ID
 */
export function generateId() {
  return 'msg_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
}

/**
 * Strips formatting characters from phone numbers and ensures it's clean for WhatsApp deep links.
 * E.g., "+1 (555) 123-4567" -> "15551234567"
 * "+20 100 123 4567" -> "201001234567"
 */
export function sanitizePhoneNumber(phone) {
  if (!phone) return '';
  // Remove all non-numeric characters except if there's no plus
  return phone.replace(/[^\d]/g, '');
}

/**
 * Validates international phone number
 */
export function isValidPhoneNumber(phone) {
  const clean = sanitizePhoneNumber(phone);
  return clean.length >= 7 && clean.length <= 15;
}

/**
 * Formats a clean phone for display
 */
export function formatPhoneNumber(phone) {
  const clean = sanitizePhoneNumber(phone);
  if (!clean) return '';
  return '+' + clean;
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Converts standard WhatsApp markup (*bold*, _italic_, ~strike~, `code`) to safe HTML
 */
export function parseWhatsAppFormatting(text) {
  if (!text) return '';
  let safe = escapeHtml(text);
  
  // Code block ```code```
  safe = safe.replace(/```([\s\S]*?)```/g, '<code class="wa-code-block">$1</code>');
  // Inline code `code`
  safe = safe.replace(/`([^`]+)`/g, '<code class="wa-inline-code">$1</code>');
  // Bold *bold*
  safe = safe.replace(/(^|[\s\W])\*([^*\n\r]+)\*($|[\s\W])/g, '$1<strong>$2</strong>$3');
  // Italic _italic_
  safe = safe.replace(/(^|[\s\W])_([^_\n\r]+)_($|[\s\W])/g, '$1<em>$2</em>$3');
  // Strikethrough ~strike~
  safe = safe.replace(/(^|[\s\W])~([^~\n\r]+)~($|[\s\W])/g, '$1<del>$2</del>$3');
  // Line breaks
  safe = safe.replace(/\n/g, '<br>');

  return safe;
}

/**
 * Formats date label (Today, Tomorrow, or Mon, Sep 3)
 */
export function formatDateLabel(dateTimeStr) {
  const date = new Date(dateTimeStr);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  
  const diffDays = Math.round((targetDate - today) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return 'Tomorrow';
  } else if (diffDays === -1) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  }
}

/**
 * Formats full readable date (e.g. September 3, 2026)
 */
export function formatFullDate(dateTimeStr) {
  const date = new Date(dateTimeStr);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Formats time (e.g. 10:00 AM)
 */
export function formatTimeLabel(dateTimeStr) {
  const date = new Date(dateTimeStr);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Formats relative countdown (e.g., "In 15 minutes", "Due now", "Sent 1 hour ago")
 */
export function formatRelativeCountdown(dateTimeStr) {
  const target = new Date(dateTimeStr).getTime();
  const now = Date.now();
  const diffSec = Math.round((target - now) / 1000);

  if (Math.abs(diffSec) <= 60) {
    return 'Due right now';
  }

  if (diffSec > 0) {
    const minutes = Math.floor(diffSec / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `In ${days} day${days > 1 ? 's' : ''}${hours % 24 > 0 ? ` ${hours % 24}h` : ''}`;
    }
    if (hours > 0) {
      return `In ${hours} hour${hours > 1 ? 's' : ''}${minutes % 60 > 0 ? ` ${minutes % 60}m` : ''}`;
    }
    return `In ${minutes} minute${minutes > 1 ? 's' : ''}`;
  } else {
    const pastSec = Math.abs(diffSec);
    const minutes = Math.floor(pastSec / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    return `${minutes} min${minutes > 1 ? 's' : ''} ago`;
  }
}

/**
 * Returns YYYY-MM-DD for standard date input value
 */
export function toInputDateFormat(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns HH:MM for standard time input value
 */
export function toInputTimeFormat(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
