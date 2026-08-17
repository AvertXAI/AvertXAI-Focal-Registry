// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: GENERATED FILE — DO NOT EDIT BY HAND. Emitted by modules/vault/seed/
//              generate-seed-xlsx.mjs from the same rows as VAULT-SEED-DATA.xlsx, so the workbook
//              Jason reads and the dataset the vault loads cannot drift. Re-run the generator to
//              change it. EVERY VALUE IS FAKE — deliberately dumb human passwords with engineered
//              reuse and stale years, so the health surface has honest work to do.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/seed-data.ts
//------------------------------------------------------------

export interface SeedEntry {
  company: string;
  fullName: string;
  username: string;
  url: string;
  password: string;
  notes: string;
  backupCodes: string[];
  securityQuestions: { question: string; answer: string }[];
}

export const SEED_ENTRIES: SeedEntry[] = [
  { company: "Adobe", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "account.adobe.com", password: "Brightflash2019!", notes: "Creative Cloud annual — card on file", backupCodes: [], securityQuestions: [{"question":"First camera?","answer":"Canon AE-1"}] },
  { company: "Amazon", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "amazon.com", password: "doggy123", notes: "Prime; Maria knows this one", backupCodes: [], securityQuestions: [{"question":"First pet?","answer":"Maggie"}] },
  { company: "Apple", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "appleid.apple.com", password: "PaulCruz1968!", notes: "iPhone + iPad backups", backupCodes: ["8341-0272","5518-9906"], securityQuestions: [{"question":"Mother's maiden name?","answer":"Gonzalez"}] },
  { company: "AT&T", fullName: "Paul Cruz", username: "pcruz210", url: "att.com", password: "sanantonio210", notes: "Family plan, 4 lines", backupCodes: [], securityQuestions: [{"question":"City of birth?","answer":"San Antonio"}] },
  { company: "Backblaze", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "backblaze.com", password: "backupbackup2020", notes: "Whole-studio backup — DO NOT LAPSE", backupCodes: [], securityQuestions: [] },
  { company: "Bank of America", fullName: "Paul Cruz", username: "paulcruz1968", url: "bankofamerica.com", password: "Maggie&Me2018", notes: "Business checking", backupCodes: [], securityQuestions: [{"question":"First car?","answer":"1998 Silverado"}] },
  { company: "Best Buy", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "bestbuy.com", password: "doggy123", notes: "Rewards account", backupCodes: [], securityQuestions: [] },
  { company: "Canon", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "canon.com/account", password: "CanonR5rocks", notes: "Gear registration + CPS", backupCodes: [], securityQuestions: [] },
  { company: "Cloudflare", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "dash.cloudflare.com", password: "kT9#mWq2$vLp8&Zr", notes: "DNS for brightflashmedia.com — set up by Jason", backupCodes: ["1194-8823","7702-3410"], securityQuestions: [] },
  { company: "Costco", fullName: "Paul & Maria Cruz", username: "cruzfamily78228", url: "costco.com", password: "costco2016", notes: "Executive membership", backupCodes: [], securityQuestions: [] },
  { company: "Dropbox", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "dropbox.com", password: "Brightflash2019!", notes: "Client galleries overflow", backupCodes: [], securityQuestions: [{"question":"First pet?","answer":"Maggie"}] },
  { company: "eBay", fullName: "Paul Cruz", username: "brightflashpaul", url: "ebay.com", password: "doggy123", notes: "Sold the old 5D here", backupCodes: [], securityQuestions: [] },
  { company: "Etsy", fullName: "Maria Cruz", username: "mariacruzprints", url: "etsy.com", password: "MariaPrints2021", notes: "Maria's print shop — Paul pays the bills", backupCodes: [], securityQuestions: [] },
  { company: "Facebook", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "facebook.com", password: "paulpaulpaul2026", notes: "Business page: Brightflash Media", backupCodes: [], securityQuestions: [{"question":"High school?","answer":"Jefferson High"}] },
  { company: "FedEx", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "fedex.com", password: "shipit2017", notes: "Print shipping account", backupCodes: [], securityQuestions: [] },
  { company: "GoDaddy", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "godaddy.com", password: "Brightflash2019!", notes: "brightflashmedia.com renewal — March", backupCodes: [], securityQuestions: [{"question":"Mother's maiden name?","answer":"Gonzalez"}] },
  { company: "Google / Gmail", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "accounts.google.com", password: "doggy123", notes: "THE main login — everything recovers here", backupCodes: ["4829-1730","9174-2206","3318-0457"], securityQuestions: [{"question":"First pet?","answer":"Maggie"}] },
  { company: "Honeybook", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "honeybook.com", password: "bookings2022", notes: "Client contracts + invoices", backupCodes: [], securityQuestions: [] },
  { company: "Instagram", fullName: "Paul Cruz", username: "@brightflashpaul", url: "instagram.com", password: "sanantonio210", notes: "Portfolio account, 12k followers", backupCodes: [], securityQuestions: [] },
  { company: "Intuit QuickBooks", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "quickbooks.intuit.com", password: "Taxes&Books2020", notes: "Bookkeeping — accountant has her own login", backupCodes: [], securityQuestions: [{"question":"First car?","answer":"1998 Silverado"}] },
  { company: "JPMorgan Chase", fullName: "Paul Cruz", username: "pcruz_biz", url: "chase.com", password: "Maggie&Me2018", notes: "Old business card — maybe closed?", backupCodes: [], securityQuestions: [{"question":"City of birth?","answer":"San Antonio"}] },
  { company: "KEH Camera", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "keh.com", password: "usedgear123", notes: "Trade-in account", backupCodes: [], securityQuestions: [] },
  { company: "LinkedIn", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "linkedin.com", password: "paulcruzphoto1", notes: "", backupCodes: [], securityQuestions: [] },
  { company: "Mailchimp", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "mailchimp.com", password: "newsletter2019", notes: "Monthly client newsletter", backupCodes: [], securityQuestions: [] },
  { company: "Netflix", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "netflix.com", password: "doggy123", notes: "Shared with the kids", backupCodes: [], securityQuestions: [] },
  { company: "Office 365", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "office.com", password: "Word&Excel2020", notes: "Studio documents", backupCodes: [], securityQuestions: [] },
  { company: "PayPal", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "paypal.com", password: "PayMe$1968", notes: "Client deposits land here", backupCodes: ["6603-1948","2271-8830"], securityQuestions: [{"question":"Mother's maiden name?","answer":"Gonzalez"}] },
  { company: "Pixieset", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "pixieset.com", password: "galleries2021", notes: "Client photo delivery", backupCodes: [], securityQuestions: [] },
  { company: "PPA", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "ppa.com", password: "photographer1968", notes: "Professional Photographers of America — insurance rides this", backupCodes: [], securityQuestions: [] },
  { company: "Quest Diagnostics", fullName: "Paul Cruz", username: "pcruz1968", url: "questdiagnostics.com", password: "health2023", notes: "Lab portal", backupCodes: [], securityQuestions: [{"question":"First pet?","answer":"Maggie"}] },
  { company: "Reddit", fullName: "Paul Cruz", username: "u/brightflashpaul", url: "reddit.com", password: "lurker123", notes: "r/WeddingPhotography mostly", backupCodes: [], securityQuestions: [] },
  { company: "ShootProof", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "shootproof.com", password: "proofing2018", notes: "Older galleries — pre-Pixieset", backupCodes: [], securityQuestions: [] },
  { company: "SmugMug", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "smugmug.com", password: "smugpaul2016", notes: "Legacy portfolio — still billed?", backupCodes: [], securityQuestions: [] },
  { company: "Spotify", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "spotify.com", password: "musicman1968", notes: "Reception playlists", backupCodes: [], securityQuestions: [] },
  { company: "Squarespace", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "squarespace.com", password: "website2022", notes: "brightflashmedia.com site", backupCodes: [], securityQuestions: [{"question":"High school?","answer":"Jefferson High"}] },
  { company: "Stripe", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "dashboard.stripe.com", password: "Xk4$nRb7@wQj2#Ty", notes: "Online booking payments — Jason set this up", backupCodes: ["0912-7734","8845-1067"], securityQuestions: [] },
  { company: "T-Mobile", fullName: "Paul Cruz", username: "pcruz210", url: "t-mobile.com", password: "sanantonio210", notes: "Studio hotspot line", backupCodes: [], securityQuestions: [{"question":"City of birth?","answer":"San Antonio"}] },
  { company: "USPS", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "usps.com", password: "stamps2019", notes: "Informed delivery + print mailers", backupCodes: [], securityQuestions: [] },
  { company: "Venmo", fullName: "Paul Cruz", username: "@Paul-Cruz-Photo", url: "venmo.com", password: "quickpay1968", notes: "Second shooters get paid here", backupCodes: [], securityQuestions: [] },
  { company: "Vimeo", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "vimeo.com", password: "weddingfilms2020", notes: "Highlight reels", backupCodes: [], securityQuestions: [] },
  { company: "WeTransfer", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "wetransfer.com", password: "bigfiles123", notes: "RAW handoffs to the retoucher", backupCodes: [], securityQuestions: [] },
  { company: "Wix", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "wix.com", password: "oldsite2015", notes: "The OLD site — cancel this?", backupCodes: [], securityQuestions: [] },
  { company: "X (Twitter)", fullName: "Paul Cruz", username: "@brightflashsa", url: "x.com", password: "tweettweet1968", notes: "Barely used", backupCodes: [], securityQuestions: [] },
  { company: "YouTube", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "youtube.com", password: "doggy123", notes: "BTS channel — rides the Google login anyway", backupCodes: [], securityQuestions: [{"question":"First pet?","answer":"Maggie"}] },
  { company: "Zelle", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "zellepay.com", password: "Maggie&Me2018", notes: "Through the BofA login", backupCodes: [], securityQuestions: [] },
  { company: "Zoom", fullName: "Paul Cruz", username: "paulcruz@brightflashmedia.com", url: "zoom.us", password: "meetings2021", notes: "Client consults", backupCodes: [], securityQuestions: [] },
];
