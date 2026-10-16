/**
 * Notification Service
 * Manages Web Notifications, Web Audio chimes, and In-App Push Banners
 */

export const NotificationService = {
  audioContext: null,

  /**
   * Request system notification permissions
   */
  async requestPermission() {
    if (!('Notification' in window)) {
      return 'unsupported';
    }
    try {
      const permission = await Notification.requestPermission();
      return permission;
    } catch (e) {
      console.warn('Error requesting notification permission:', e);
      return 'denied';
    }
  },

  /**
   * Get current permission status ('default' | 'granted' | 'denied' | 'unsupported')
   */
  getPermissionStatus() {
    if (!('Notification' in window)) {
      return 'unsupported';
    }
    return Notification.permission;
  },

  /**
   * Plays a pleasant chime sound using Web Audio API
   */
  playNotificationSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      if (!this.audioContext) {
        this.audioContext = new AudioCtx();
      }

      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      const now = this.audioContext.currentTime;
      
      // Dual-tone WhatsApp-style chime (two sine harmonics)
      const osc1 = this.audioContext.createOscillator();
      const osc2 = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';

      // First chime note: 587.33 Hz (D5) -> 880 Hz (A5)
      osc1.frequency.setValueAtTime(587.33, now);
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15);

      osc2.frequency.setValueAtTime(880, now);
      osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.2);

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.audioContext.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.5);
      osc2.stop(now + 0.5);

      // Trigger light device vibration if supported
      if ('vibrate' in navigator) {
        navigator.vibrate([100, 50, 150]);
      }
    } catch (e) {
      console.warn('Audio synthesis note could not be played:', e);
    }
  },

  /**
   * Trigger both System Notification and In-App Banner
   */
  dispatchScheduledNotification(message, { onActionClick } = {}) {
    // 1. Play sound
    this.playNotificationSound();

    // 2. Fire System Web Notification if permitted
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const title = `📱 Mensagem do WhatsApp`;
        const body = `Hora de enviar sua mensagem agendada para ${message.recipientName}.\n"${message.message.substring(0, 60)}${message.message.length > 60 ? '...' : ''}"`;
        
        const notification = new Notification(title, {
          body: body,
          icon: '/favicon.svg',
          badge: '/favicon.svg',
          tag: message.id,
          renotify: true,
          requireInteraction: true
        });

        notification.onclick = function() {
          window.focus();
          notification.close();
          if (typeof onActionClick === 'function') {
            onActionClick();
          }
        };
      } catch (err) {
        console.warn('System notification display error:', err);
      }
    }

    // 3. Show In-App Sliding Push Banner
    this.showInAppBanner(message, onActionClick);
  },

  /**
   * Displays the top interactive push banner within the application
   */
  showInAppBanner(message, onActionClick) {
    const banner = document.getElementById('notificationBanner');
    if (!banner) return;

    const titleEl = banner.querySelector('.banner-title');
    const msgEl = banner.querySelector('.banner-msg');
    const actionBtn = banner.querySelector('.banner-action-btn');
    const closeBtn = banner.querySelector('.banner-close');

    if (titleEl) titleEl.textContent = `Hora de enviar mensagem para ${message.recipientName}`;
    if (msgEl) msgEl.textContent = `"${message.message}"`;

    if (actionBtn) {
      actionBtn.onclick = () => {
        banner.classList.remove('active');
        if (typeof onActionClick === 'function') {
          onActionClick();
        }
      };
    }

    if (closeBtn) {
      closeBtn.onclick = () => {
        banner.classList.remove('active');
      };
    }

    banner.classList.add('active');

    // Auto-dismiss banner after 12 seconds
    clearTimeout(banner._dismissTimeout);
    banner._dismissTimeout = setTimeout(() => {
      banner.classList.remove('active');
    }, 12000);
  }
};
