/**
 * Contacts Service & Country Directory
 */

export const COUNTRY_CODES = [
  { code: 'EG', name: 'Egypt', dial: '+20', flag: '🇪🇬' },
  { code: 'US', name: 'United States', dial: '+1', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', dial: '+44', flag: '🇬🇧' },
  { code: 'IN', name: 'India', dial: '+91', flag: '🇮🇳' },
  { code: 'SA', name: 'Saudi Arabia', dial: '+966', flag: '🇸🇦' },
  { code: 'AE', name: 'United Arab Emirates', dial: '+971', flag: '🇦🇪' },
  { code: 'DE', name: 'Germany', dial: '+49', flag: '🇩🇪' },
  { code: 'FR', name: 'France', dial: '+33', flag: '🇫🇷' },
  { code: 'CA', name: 'Canada', dial: '+1', flag: '🇨🇦' },
  { code: 'AU', name: 'Australia', dial: '+61', flag: '🇦🇺' },
  { code: 'BR', name: 'Brazil', dial: '+55', flag: '🇧🇷' },
  { code: 'NG', name: 'Nigeria', dial: '+234', flag: '🇳🇬' },
  { code: 'PK', name: 'Pakistan', dial: '+92', flag: '🇵🇰' },
  { code: 'KW', name: 'Kuwait', dial: '+965', flag: '🇰🇼' },
  { code: 'QA', name: 'Qatar', dial: '+974', flag: '🇶🇦' }
];

export const ContactsService = {
  /**
   * Checks if native device contact picker API is supported
   */
  isNativeContactPickerSupported() {
    return 'contacts' in navigator && 'ContactsManager' in window;
  },

  /**
   * Picks a contact directly from device contact book using Native API if available
   */
  async pickNativeContact() {
    if (!this.isNativeContactPickerSupported()) {
      return null;
    }

    try {
      const props = ['name', 'tel'];
      const contacts = await navigator.contacts.select(props, { multiple: false });
      if (contacts && contacts.length > 0) {
        const contact = contacts[0];
        const name = contact.name && contact.name.length > 0 ? contact.name[0] : 'Contact';
        const tel = contact.tel && contact.tel.length > 0 ? contact.tel[0] : '';
        return {
          name: name,
          phone: tel
        };
      }
    } catch (e) {
      console.warn('Native contact picker cancelled or failed:', e);
    }
    return null;
  }
};
