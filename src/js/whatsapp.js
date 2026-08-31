/**
 * WhatsApp Deep Linking & Protocol Service
 * Handles wa.me URL creation and dispatching to WhatsApp native app or web
 */

import { sanitizePhoneNumber } from './utils.js';

export const WhatsAppService = {
  /**
   * Generates a standard universal WhatsApp deep link
   * Format: https://wa.me/<number>?text=<urlencodedtext>
   */
  getDeepLink(phone, message) {
    const cleanPhone = sanitizePhoneNumber(phone);
    const encodedText = encodeURIComponent(message || '');
    return `https://wa.me/${cleanPhone}?text=${encodedText}`;
  },

  /**
   * Generates custom app protocol link (whatsapp://send?phone=...&text=...)
   */
  getAppProtocolLink(phone, message) {
    const cleanPhone = sanitizePhoneNumber(phone);
    const encodedText = encodeURIComponent(message || '');
    return `whatsapp://send?phone=${cleanPhone}&text=${encodedText}`;
  },

  /**
   * Attempts to launch WhatsApp with pre-filled recipient and message
   */
  openWhatsApp(phone, message, { onOpenSuccess, onFallback } = {}) {
    const url = this.getDeepLink(phone, message);
    
    // Copy message to clipboard automatically as a user-friendly safeguard
    if (navigator.clipboard && message) {
      navigator.clipboard.writeText(message).catch(() => {});
    }

    try {
      // Use window.open to launch the wa.me universal URL which automatically
      // redirects to the native WhatsApp app on Android/iOS/Desktop or WhatsApp Web.
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (win) {
        if (typeof onOpenSuccess === 'function') onOpenSuccess();
      } else {
        // Pop-up blocked, navigate directly
        window.location.href = url;
      }
      return true;
    } catch (err) {
      console.warn('Failed to open WhatsApp URL directly:', err);
      if (typeof onFallback === 'function') {
        onFallback(url);
      } else {
        window.location.href = url;
      }
      return false;
    }
  }
};
