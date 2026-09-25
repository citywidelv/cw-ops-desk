/* nav.js for the Ops Hub. Seeded from the page menu on 2026-09-13 by Claude.
   The Site Admin hub (cw-admin-hub/site-admin.html) republishes this file; do not edit by hand.
   The page keeps its own MENU as a fallback if this file is missing or malformed.
   Edited by hand 2026-09-25 (menu cleanup: one home per tool, short labels with tag chips; Opportunities promoted, Work Tickets under Accounts): before the next Site Admin publish, click Import live menu. */
window.CW_NAV = {
 "hub": "ops",
 "label": "Ops Hub",
 "menu": [
  {
   "label": "Opportunities",
   "icon": "board",
   "items": [
    {
     "label": "Post an Opportunity",
     "href": "post.html"
    },
    {
     "label": "Active Postings",
     "href": "postings.html"
    },
    {
     "label": "Vendor Responses",
     "href": "responses.html"
    },
    {
     "label": "Live Board",
     "href": "https://citywidelv.github.io/cw-vendor-hub/opportunities.html",
     "tag": "Vendor Hub"
    },
    {
     "label": "Edit a Posting",
     "href": "https://citywidelv.github.io/cw-admin-hub/records.html?s=postings&f=Open",
     "tag": "Admin"
    }
   ]
  },
  {
   "label": "Vendors",
   "icon": "clip",
   "items": [
    {
     "label": "Vendor Email",
     "href": "vendor-email.html"
    },
    {
     "label": "Vendor Profile",
     "href": "https://citywidelv.github.io/cw-admin-hub/vendor-profile.html",
     "tag": "Admin"
    },
    {
     "sub": "Directory",
     "items": [
      {
       "label": "Las Vegas",
       "href": "vendors.html#/lv"
      },
      {
       "label": "Northern Nevada",
       "href": "vendors.html#/nnv"
      },
      {
       "label": "Add a Vendor",
       "href": "vendor-add.html"
      },
      {
       "label": "Do Not Email or Remove",
       "href": "vendor-dne.html"
      }
     ]
    },
    {
     "sub": "Invite and Onboard",
     "items": [
      {
       "label": "Invite for Las Vegas",
       "href": "vendor-invite.html?region=lv"
      },
      {
       "label": "Invite for Northern Nevada",
       "href": "vendor-invite.html?region=nnv"
      },
      {
       "label": "Onboarding Status",
       "href": "https://citywidelv.github.io/cw-admin-hub/onboarding.html",
       "tag": "Admin"
      },
      {
       "label": "New Vendor Steps",
       "href": "https://citywidelv.github.io/cw-vendor-hub/new-vendors.html",
       "tag": "Vendor Hub"
      },
      {
       "label": "Evaluation Form",
       "href": "https://citywidelv.github.io/cw-vendor-hub/vendor-evaluation.html",
       "tag": "Vendor Hub"
      }
     ]
    },
    {
     "sub": "Exhibit A",
     "items": [
      {
       "label": "Create an Exhibit A",
       "href": "create-exhibit-a.html"
      },
      {
       "label": "Request an Exhibit A",
       "href": "https://form.asana.com/?k=Ch8IqpDXjkcNqdqvjV5-oA&d=13140959242873",
       "tag": "Asana"
      },
      {
       "label": "Exhibit A Requests",
       "href": "https://app.asana.com/1/13140959242873/project/1211502025570262",
       "tag": "Asana"
      }
     ]
    },
    {
     "sub": "Violations and Audits",
     "items": [
      {
       "label": "Issue a Violation Notice",
       "href": "violations.html"
      },
      {
       "label": "Submit a Vendor Audit",
       "href": "vendor-audit.html"
      },
      {
       "label": "Audits Due, Las Vegas",
       "href": "vendors.html#/lv/janitorial/audit"
      },
      {
       "label": "Audits Due, Northern Nevada",
       "href": "vendors.html#/nnv/janitorial/audit"
      }
     ]
    },
    {
     "sub": "Insurance and Clearance",
     "items": [
      {
       "label": "Request COIs from Vendors",
       "href": "insurance.html"
      },
      {
       "label": "Background Check Notices",
       "href": "bc-notices.html"
      },
      {
       "label": "Record Clearance Results",
       "href": "https://citywidelv.github.io/cw-admin-hub/background-checks.html",
       "tag": "Admin"
      },
      {
       "label": "Verified First",
       "href": "https://portal.verifiedfirst.com/#/dashboard",
       "tag": "Site"
      },
      {
       "label": "InsurLink",
       "href": "https://insurlink.vertafore.com/end-insured/2260313c6a34459c8a098ede23d21fb7/2094911/overview",
       "tag": "Site"
      }
     ]
    },
    {
     "sub": "Vendor of the Month",
     "items": [
      {
       "label": "Nominate a Vendor or G.O.A.T.",
       "href": "nominate.html"
      },
      {
       "label": "The Wall",
       "href": "https://citywidelv.github.io/cw-vendor-hub/#recognition",
       "tag": "Vendor Hub"
      },
      {
       "label": "Add a Vendor of the Month",
       "href": "https://citywidelv.github.io/cw-admin-hub/recognition.html#add",
       "tag": "Admin"
      },
      {
       "label": "Winners and Plates",
       "href": "https://citywidelv.github.io/cw-admin-hub/recognition.html",
       "tag": "Admin"
      }
     ]
    },
    {
     "label": "Cleaner Roster",
     "href": "cleaners.html"
    },
    {
     "label": "Vendor Hub",
     "href": "https://citywidelv.github.io/cw-vendor-hub/",
     "tag": "Vendor Hub"
    }
   ]
  },
  {
   "label": "Accounts & Buildings",
   "icon": "map",
   "items": [
    {
     "label": "Building Survey",
     "href": "https://citywidelv.github.io/BuildingSurvey/"
    },
    {
     "sub": "Building Info Sheets",
     "items": [
      {
       "label": "Sheet Library",
       "href": "building-sheets.html"
      },
      {
       "label": "New or Update a Sheet",
       "href": "building-sheet.html"
      }
     ]
    },
    {
     "sub": "Work Tickets",
     "items": [
      {
       "label": "Maintenance Work Ticket",
       "href": "work-order.html"
      },
      {
       "label": "Snow Service Report",
       "href": "snow-report.html"
      },
      {
       "label": "CCCNV Work Requests",
       "href": "form-view.html?f=cccnv_req"
      },
      {
       "label": "CCCNV Request Form",
       "href": "https://form.jotform.com/252935932465163",
       "tag": "Jotform"
      },
      {
       "label": "Handyman Work Orders",
       "href": "form-view.html?f=handyman_wo"
      },
      {
       "label": "Handyman Order Form",
       "href": "https://form.jotform.com/240175011302033",
       "tag": "Jotform"
      },
      {
       "label": "7-Eleven Handteq Point",
       "href": "https://point.handteq.com/development/app/output2/seveneleven/web/gray.0.7.0",
       "tag": "Site"
      }
     ]
    },
    {
     "sub": "Account Changes",
     "items": [
      {
       "label": "Log an Account Change",
       "href": "act-entry.html"
      },
      {
       "label": "Log a Ledger Change",
       "href": "act-entry.html?doc=ledger"
      },
      {
       "label": "ACT and Ledger Documents",
       "href": "https://citywidelv.github.io/cw-admin-hub/act-document.html",
       "tag": "Admin"
      },
      {
       "label": "Accounting Queue",
       "href": "https://citywidelv.github.io/cw-admin-hub/accounting-queue.html",
       "tag": "Admin"
      },
      {
       "label": "Account Directory",
       "href": "https://citywidelv.github.io/cw-admin-hub/accounts.html",
       "tag": "Admin"
      }
     ]
    },
    {
     "sub": "Customer COIs",
     "items": [
      {
       "label": "Request a COI for a Customer",
       "href": "coi-request.html"
      },
      {
       "label": "COI Request Log",
       "href": "https://citywidelv.github.io/cw-admin-hub/coi-log.html",
       "tag": "Admin"
      }
     ]
    },
    {
     "sub": "Accounts Map",
     "items": [
      {
       "label": "Las Vegas",
       "href": "https://www.google.com/maps/d/viewer?mid=1ewhUmSrFCo0--ALiJP0O1pLTbH0qlk4"
      },
      {
       "label": "Northern Nevada",
       "href": "https://www.google.com/maps/d/viewer?mid=1_o8DPUf6zH9kiAcZuNEOCAbZLq93nnc"
      }
     ]
    }
   ]
  },
  {
   "label": "Pricing & Bids",
   "icon": "margin",
   "items": [
    {
     "sub": "Bid Calculators",
     "items": [
      {
       "label": "OS Pricing Tool",
       "href": "os-pricing.html"
      },
      {
       "label": "Apartment Turns",
       "href": "https://citywidelv.github.io/apartment-turns/"
      },
      {
       "label": "Waxable Floors",
       "href": "https://citywidelv.github.io/strip-and-wax-calculator/"
      },
      {
       "label": "Carpet Cleaning",
       "href": "https://citywidelv.github.io/Carpet-Cleaning/"
      },
      {
       "label": "Window Cleaning",
       "href": "https://citywidelv.github.io/windowcleaningcalculator/"
      },
      {
       "label": "Pressure Washing",
       "href": "https://citywidelv.github.io/powerwashing/"
      },
      {
       "label": "Post-Construction Clean",
       "href": "https://citywidelv.github.io/post-construction-clean/"
      },
      {
       "label": "Restaurant Cleaning",
       "href": "https://citywidelv.github.io/restaurants/"
      },
      {
       "label": "Landscaping Maintenance",
       "href": "https://citywidelv.github.io/landscapingmaintenance/"
      },
      {
       "label": "Exterior Porter",
       "href": "https://citywidelv.github.io/porter-exterior/"
      }
     ]
    },
    {
     "sub": "Business Numbers",
     "items": [
      {
       "label": "Margin Calculator",
       "href": "https://citywidelv.github.io/margincalculator/"
      },
      {
       "label": "Revenue Retention (TRR)",
       "href": "https://citywidelv.github.io/retentioncalculator/"
      }
     ]
    }
   ]
  },
  {
   "label": "Night Ops",
   "icon": "clock",
   "items": [
    {
     "sub": "Night Inspection",
     "items": [
      {
       "label": "Night Inspection Form",
       "href": "https://form.jotform.com/233486327771060",
       "tag": "Jotform"
      },
      {
       "label": "Night Inspection Page",
       "href": "night-inspection.html",
       "tag": "New"
      },
      {
       "label": "Inspection Recaps",
       "href": "night-inspections.html"
      },
      {
       "label": "Inspections, Las Vegas",
       "href": "form-view.html?f=ni_lv"
      },
      {
       "label": "Inspections, Northern Nevada",
       "href": "form-view.html?f=ni_nnv"
      }
     ]
    },
    {
     "sub": "Route Out",
     "items": [
      {
       "label": "Route Out",
       "href": "night-route.html",
       "tag": "New"
      },
      {
       "label": "Route Out Tonight",
       "href": "night-route.html#status"
      },
      {
       "label": "Route Out Form",
       "href": "https://form.jotform.com/241440730763149",
       "tag": "Jotform"
      },
      {
       "label": "Route Out Form, NNV",
       "href": "https://form.jotform.com/team/253234894174059/nnv-night-manager-route-out",
       "tag": "Jotform"
      }
     ]
    },
    {
     "label": "Night Manager AI Tool",
     "href": "https://chatgpt.com/g/g-681233262c3c81918605de9bd3edf7be-city-wide-night-manager-tool",
     "tag": "Site"
    }
   ]
  },
  {
   "label": "Team & Admin",
   "icon": "home",
   "items": [
    {
     "sub": "Power BI",
     "items": [
      {
       "label": "FSM Reports and Targets",
       "href": "powerbi.html#fsm"
      },
      {
       "label": "Director Reports",
       "href": "powerbi.html#director"
      },
      {
       "label": "Open Power BI",
       "href": "https://app.powerbi.com/home?experience=power-bi",
       "tag": "Site"
      },
      {
       "label": "Dashboard Explainer",
       "href": "https://vimeo.com/1072632984/313ecdd885",
       "tag": "Vimeo"
      }
     ]
    },
    {
     "sub": "CRM and Billing",
     "items": [
      {
       "label": "CW Sales CRM",
       "href": "https://gocitywide.crm.dynamics.com/main.aspx",
       "tag": "Site"
      },
      {
       "label": "Create a Supply Invoice",
       "href": "https://supplysales.powerappsportals.com/SignIn?ReturnUrl=%2FCustomer-Select%2F",
       "tag": "Site"
      },
      {
       "label": "Request a Supply Item",
       "href": "https://form.jotform.com/tjroberts/supply-item-request-for-field-sales",
       "tag": "Jotform"
      },
      {
       "label": "Create an Extra Charge",
       "href": "https://apps.powerapps.com/play/e/58e2128b-deac-e675-8cd1-7d879ca63711/a/a052bc89-2125-4efd-88e5-682f1d2dbcd0?tenantId=3b214a92-dd33-4a9c-a070-43f6783d144c&hint=a842db25-40d4-46c0-b151-6ad085ee7345&sourcetime=1756059511414&source=portal",
       "tag": "Site"
      }
     ]
    },
    {
     "sub": "Team",
     "items": [
      {
       "label": "Admin Hub",
       "href": "https://citywidelv.github.io/cw-admin-hub/"
      },
      {
       "label": "Asana",
       "href": "https://app.asana.com/",
       "tag": "Site"
      },
      {
       "label": "Employee Uniforms",
       "href": "uniforms.html"
      },
      {
       "label": "ADP TotalSource",
       "href": "https://workforcenow.adp.com/",
       "tag": "Site"
      },
      {
       "label": "Order CW Merch",
       "href": "https://cwlv.printful.me/",
       "tag": "Site"
      },
      {
       "label": "Team Emails by Position",
       "href": "https://citywidelv.github.io/cw-admin-hub/team-emails.html",
       "tag": "Admin"
      }
     ]
    },
    {
     "sub": "Team Apps",
     "items": [
      {
       "label": "Slack",
       "href": "https://slack.com/signin"
      },
      {
       "label": "Microsoft Bookings",
       "href": "https://bookings.cloud.microsoft/bookings/homepage"
      },
      {
       "label": "Jotform",
       "href": "https://www.jotform.com/myforms/"
      },
      {
       "label": "ZoomInfo",
       "href": "https://app.zoominfo.com/"
      },
      {
       "label": "CW Score Cloud",
       "href": "https://cwfscorecloud.gocitywide.com/login"
      },
      {
       "label": "City Wide YOU",
       "href": "https://gocitywide.docebosaas.com/pages/19/city-wide-you"
      }
     ]
    },
    {
     "label": "Form Submissions",
     "href": "forms.html"
    },
    {
     "label": "Office Inventory",
     "href": "inventory-onhand.html"
    },
    {
     "label": "Order More EnvirOx",
     "href": "envirox.html"
    }
   ]
  }
 ],
 "quick": [
  {
   "label": "Post an Opportunity",
   "href": "post.html",
   "icon": "plus",
   "primary": true
  },
  {
   "label": "Active Postings",
   "href": "postings.html",
   "icon": "mail"
  },
  {
   "label": "Live Board",
   "href": "https://citywidelv.github.io/cw-vendor-hub/opportunities.html",
   "icon": "board",
   "pill": true
  },
  {
   "label": "Nominate a Vendor / G.O.A.T.",
   "href": "nominate.html",
   "icon": "plus"
  },
  {
   "label": "Create an Exhibit A",
   "href": "create-exhibit-a.html",
   "icon": "clip"
  },
  {
   "label": "Exhibit A Request",
   "href": "https://form.asana.com/?k=Ch8IqpDXjkcNqdqvjV5-oA&d=13140959242873",
   "icon": "clip"
  },
  {
   "label": "Vendor Email",
   "href": "vendor-email.html",
   "icon": "mail"
  },
  {
   "label": "Invite a New Vendor",
   "href": "vendor-invite.html",
   "icon": "mail"
  },
  {
   "label": "Night Inspection",
   "href": "https://form.jotform.com/233486327771060",
   "icon": "clip"
  },
  {
   "label": "CW Sales CRM",
   "href": "https://gocitywide.crm.dynamics.com/main.aspx",
   "icon": "work"
  },
  {
   "label": "Margin Calculator",
   "href": "https://citywidelv.github.io/margincalculator/",
   "icon": "margin"
  },
  {
   "label": "Vendor Hub",
   "href": "https://citywidelv.github.io/cw-vendor-hub/",
   "icon": "home"
  }
 ]
};
