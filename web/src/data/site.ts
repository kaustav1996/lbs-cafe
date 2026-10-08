// Everything the cafe might want to change lives here until the admin's CMS takes over.

export interface DayHours { open: string; close: string } // 24h "HH:MM"

export const SITE = {
  name: "LB's Hemp Cafe & Lounge",
  short: "LB's",
  domain: 'lbscafe.com',
  address: {
    line1: 'LB’s, 29 BJ, BJ Block, Sector 2',
    city: 'Salt Lake, Kolkata 700091',
    full: 'LB’s, 29 BJ, BJ Block, Sector 2, Bidhannagar, Kolkata, West Bengal 700091',
  },
  phone: '+91 98754 31882',
  phoneHref: 'tel:+919875431882',
  email: 'lbsfrequency@gmail.com',
  mapsUrl:
    'https://www.google.com/maps/search/?api=1&query=' +
    // The address exactly as Google Maps lists the cafe, so directions land on the right pin.
    encodeURIComponent('Bidhan Nagar, 29 BJ, BJ Block, Sector 2, Kolkata, Bidhannagar, West Bengal 700091'),
  // Leave blank to hide. Fill in once confirmed.
  instagram: '',
  facebook: '',
  payments: 'cash, cards and UPI',
  gstRate: 0.18, // Confirmed by the cafe (Oct 2026). Split 9% CGST + 9% SGST on bills.
  // Confirmed by the cafe (Oct 2026): 10 am to 10 pm, every day. Index 0 = Sunday.
  hours: Array.from({ length: 7 }, () => ({ open: '10:00', close: '22:00' })) as DayHours[],
};

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
