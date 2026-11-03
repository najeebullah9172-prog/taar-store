'use strict';
// Pakistan specific reference data used for addresses and shipping zones.

const PROVINCES = [
  'Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan',
  'Islamabad Capital Territory', 'Gilgit-Baltistan', 'Azad Jammu and Kashmir',
];

const CITIES = {
  'Lahore': 'Punjab', 'Karachi': 'Sindh', 'Islamabad': 'Islamabad Capital Territory',
  'Rawalpindi': 'Punjab', 'Peshawar': 'Khyber Pakhtunkhwa', 'Faisalabad': 'Punjab',
  'Multan': 'Punjab', 'Gujranwala': 'Punjab', 'Sialkot': 'Punjab', 'Hyderabad': 'Sindh',
  'Quetta': 'Balochistan', 'Bahawalpur': 'Punjab', 'Sargodha': 'Punjab', 'Sukkur': 'Sindh',
  'Larkana': 'Sindh', 'Abbottabad': 'Khyber Pakhtunkhwa', 'Mardan': 'Khyber Pakhtunkhwa',
  'Swat': 'Khyber Pakhtunkhwa', 'Gujrat': 'Punjab', 'Sahiwal': 'Punjab', 'Sheikhupura': 'Punjab',
  'Rahim Yar Khan': 'Punjab', 'Jhelum': 'Punjab', 'Okara': 'Punjab', 'Kasur': 'Punjab',
  'Dera Ghazi Khan': 'Punjab', 'Dera Ismail Khan': 'Khyber Pakhtunkhwa', 'Kohat': 'Khyber Pakhtunkhwa',
  'Nawabshah': 'Sindh', 'Mirpur Khas': 'Sindh', 'Gwadar': 'Balochistan', 'Turbat': 'Balochistan',
  'Gilgit': 'Gilgit-Baltistan', 'Skardu': 'Gilgit-Baltistan', 'Muzaffarabad': 'Azad Jammu and Kashmir',
  'Mirpur': 'Azad Jammu and Kashmir', 'Chiniot': 'Punjab', 'Wah Cantt': 'Punjab', 'Attock': 'Punjab',
  'Nowshera': 'Khyber Pakhtunkhwa', 'Mansehra': 'Khyber Pakhtunkhwa',
};

const CITY_LIST = Object.keys(CITIES).sort((a, b) => a.localeCompare(b));

// Accepts 03XXXXXXXXX, +923XXXXXXXXX, 923XXXXXXXXX with optional spaces or hyphens.
function normalizePhone(input) {
  const digits = String(input || '').replace(/[\s-]/g, '');
  let m = digits.match(/^(?:\+?92|0)(3\d{9})$/);
  if (m) return `+92${m[1]}`;
  m = digits.match(/^(?:\+?92|0)([1-9]\d{8,9})$/); // landline
  if (m) return `+92${m[1]}`;
  return null;
}

function formatPhone(e164) {
  if (!e164) return '';
  const m = e164.match(/^\+92(3\d{2})(\d{7})$/);
  return m ? `0${m[1]} ${m[2]}` : e164;
}

module.exports = { PROVINCES, CITIES, CITY_LIST, normalizePhone, formatPhone };
