/* nav.js for the Ops Hub. Seeded from the page menu on 2026-09-13 by Claude.
   The Site Admin hub (cw-admin-hub/site-admin.html) republishes this file; do not edit by hand.
   The page keeps its own MENU as a fallback if this file is missing or malformed.
   Edited by hand 2026-09-24 (Exhibit A cascade and quick chip, Vendor Evaluation link; Form Submissions cascade and Jotform hub views): before the next Site Admin publish, click Import live menu. */
window.CW_NAV = {
 "hub": "ops",
 "label": "Ops Hub",
 "menu": [
  {
   "label": "Work Tickets",
   "icon": "sheet",
   "items": [
    {
     "label": "Maintenance Work Ticket",
     "href": "work-order.html"
    },
    {
     "ghead": "Snow & Ice"
    },
    {
     "label": "Snow Service Report",
     "href": "snow-report.html"
    },
    {
     "ghead": "7-Eleven"
    },
    {
     "label": "Handteq Point (7-Eleven maintenance app)",
     "href": "https://point.handteq.com/development/app/output2/seveneleven/web/gray.0.7.0"
    },
    {
     "ghead": "CCCNV (Comprehensive Cancer)"
    },
    {
     "label": "CCCNV Work Requests (hub view)",
     "href": "form-view.html?f=cccnv_req",
     "tag": "New"
    },
    {
     "label": "CCCNV Work Request form (Jotform)",
     "href": "https://form.jotform.com/252935932465163"
    },
    {
     "ghead": "Handyman"
    },
    {
     "label": "Completed Work Orders (hub view)",
     "href": "form-view.html?f=handyman_wo",
     "tag": "New"
    },
    {
     "label": "Handyman Work Order form (Jotform)",
     "href": "https://form.jotform.com/240175011302033"
    },
    {
     "ghead": "Tracking"
    },
    {
     "label": "Work Tickets Sheet",
     "href": "https://docs.google.com/spreadsheets/d/17awrIV6X-Ugaxkw0VLDIH8WVpJ51Ux_5ntNxHu2tzBg/edit"
    },
    {
     "label": "Snow Reports Sheet",
     "href": "https://docs.google.com/spreadsheets/d/1hoeWUmO4l881SbrPfC28M-R0uLeslT3i48nqDv4VXAs/edit"
    }
   ]
  },
  {
   "label": "Vendors",
   "icon": "clip",
   "items": [
    {
     "label": "Vendor Email (one place to send)",
     "href": "vendor-email.html"
    },
    {
     "sub": "Active Vendors",
     "items": [
      {
       "ghead": "Las Vegas"
      },
      {
       "label": "Janitorial",
       "href": "vendors.html#/lv/janitorial"
      },
      {
       "label": "Other Services",
       "href": "vendors.html#/lv/other"
      },
      {
       "label": "Prospects",
       "href": "vendors.html#/lv/prospects"
      },
      {
       "ghead": "Northern Nevada"
      },
      {
       "label": "Janitorial",
       "href": "vendors.html#/nnv/janitorial"
      },
      {
       "label": "Other Services",
       "href": "vendors.html#/nnv/other"
      },
      {
       "label": "Prospects",
       "href": "vendors.html#/nnv/prospects"
      },
      {
       "ghead": "Maintain"
      },
      {
       "label": "Add a Vendor",
       "href": "vendor-add.html"
      },
      {
       "label": "Do Not Email or Remove a Vendor",
       "href": "vendor-dne.html"
      },
      {
       "label": "Vendor Directory (Sheet)",
       "href": "https://docs.google.com/spreadsheets/d/1kHRyeQzDsi-bnfE5YpD_KPV17GeD5aJ_5vrDQGU_s-0/edit"
      }
     ]
    },
    {
     "sub": "Quarterly Audits",
     "items": [
      {
       "label": "Submit a Vendor Audit",
       "href": "vendor-audit.html"
      },
      {
       "label": "Audits Due (Las Vegas)",
       "href": "vendors.html#/lv/janitorial/audit"
      },
      {
       "label": "Audits Due (Northern Nevada)",
       "href": "vendors.html#/nnv/janitorial/audit"
      },
      {
       "label": "Audit Log (Sheet)",
       "href": "https://docs.google.com/spreadsheets/d/1O7G0aNUXKpgoebaSIfYJlJiIoCJ7pbMcMJq9derYgb4/edit"
      }
     ]
    },
    {
     "sub": "Opportunities",
     "items": [
      {
       "label": "Post an Opportunity",
       "href": "post.html"
      },
      {
       "label": "Active Postings (Email Vendors)",
       "href": "postings.html"
      },
      {
       "label": "Live Board",
       "href": "https://citywidelv.github.io/cw-vendor-hub/opportunities.html"
      },
      {
       "label": "Vendor Responses",
       "href": "responses.html"
      },
      {
       "ghead": "Tracking"
      },
      {
       "label": "Cleaner Roster",
       "href": "cleaners.html"
      },
      {
       "label": "Edit Active Postings",
       "href": "https://citywidelv.github.io/cw-admin-hub/records.html?s=postings&f=Open"
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
       "label": "The Wall (Vendor Hub)",
       "href": "https://citywidelv.github.io/cw-vendor-hub/#recognition"
      },
      {
       "ghead": "Admin Hub"
      },
      {
       "label": "Add a Vendor of the Month",
       "href": "https://citywidelv.github.io/cw-admin-hub/recognition.html#add"
      },
      {
       "label": "Nominations & Plates",
       "href": "https://citywidelv.github.io/cw-admin-hub/recognition.html"
      }
     ]
    },
    {
     "sub": "Violations",
     "items": [
      {
       "label": "Issue a Violation Notice",
       "href": "violations.html"
      },
      {
       "label": "Violation Log (Sheet)",
       "href": "https://docs.google.com/spreadsheets/d/16Hf_lY_N8n3hPq4WDpPmXtyEs4Gdn-KV54-OUQUa-NI/edit"
      }
     ]
    },
    {
     "sub": "Insurance",
     "items": [
      {
       "label": "Request COIs from Vendors",
       "href": "insurance.html"
      },
      {
       "label": "Insurance Request Log (Sheet)",
       "href": "https://docs.google.com/spreadsheets/d/1o6PT9fbieaANh7gtt5egYLf_RCjILZPp4D7NWDwVio8/edit"
      },
      {
       "label": "Vendor Upload Page",
       "href": "https://citywidelv.github.io/cw-vendor-hub/upload.html"
      },
      {
       "ghead": "Broker Portal"
      },
      {
       "label": "InsurLink (Vertafore)",
       "href": "https://insurlink.vertafore.com/end-insured/2260313c6a34459c8a098ede23d21fb7/2094911/overview"
      }
     ]
    },
    {
     "sub": "Background Checks",
     "items": [
      {
       "label": "Record Clearance Results (Admin Hub)",
       "href": "https://citywidelv.github.io/cw-admin-hub/background-checks.html"
      },
      {
       "label": "Send Background Check Notices",
       "href": "bc-notices.html"
      },
      {
       "label": "Background Checks on File (Las Vegas Sheet)",
       "href": "https://docs.google.com/spreadsheets/d/1a_Usbs1FIzaZPnbUpc8vqFg2XV2_QjTAKtqVNPxBPh8/edit"
      },
      {
       "label": "Background Checks on File (Northern Nevada Sheet)",
       "href": "https://docs.google.com/spreadsheets/d/1a_Usbs1FIzaZPnbUpc8vqFg2XV2_QjTAKtqVNPxBPh8/edit"
      },
      {
       "label": "Vendor Background Check Request (Vendor Hub)",
       "href": "https://citywidelv.github.io/cw-vendor-hub/background-check.html"
      },
      {
       "label": "Verified First (portal)",
       "href": "https://portal.verifiedfirst.com/#/dashboard"
      }
     ]
    },
    {
     "sub": "Invite a New Vendor",
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
       "label": "New Vendor Onboarding Status (Admin Hub)",
       "href": "https://citywidelv.github.io/cw-admin-hub/onboarding.html",
       "tag": "Admin Hub"
      },
      {
       "ghead": "Where the invite takes them"
      },
      {
       "label": "New Vendor Steps (Vendor Hub)",
       "href": "https://citywidelv.github.io/cw-vendor-hub/new-vendors.html"
      },
      {
       "label": "Vendor Evaluation Form (Vendor Hub)",
       "href": "https://citywidelv.github.io/cw-vendor-hub/vendor-evaluation.html"
      },
      {
       "ghead": "Then"
      },
      {
       "label": "Prospects (Las Vegas)",
       "href": "vendors.html#/lv/prospects"
      },
      {
       "label": "Prospects (Northern Nevada)",
       "href": "vendors.html#/nnv/prospects"
      },
      {
       "label": "Add a Vendor by Hand",
       "href": "vendor-add.html"
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
       "label": "Request an Exhibit A (Asana form)",
       "href": "https://form.asana.com/?k=Ch8IqpDXjkcNqdqvjV5-oA&d=13140959242873"
      },
      {
       "label": "Exhibit A Requests board",
       "href": "https://app.asana.com/1/13140959242873/project/1211502025570262",
       "tag": "Asana"
      }
     ]
    },
    {
     "sub": "Vendor Resources",
     "items": [
      {
       "label": "Resource Home",
       "href": "https://citywidelv.github.io/cw-vendor-hub/"
      },
      {
       "label": "New Vendor Steps",
       "href": "https://citywidelv.github.io/cw-vendor-hub/new-vendors.html"
      },
      {
       "label": "Open Opportunities Board",
       "href": "https://citywidelv.github.io/cw-vendor-hub/opportunities.html"
      },
      {
       "ghead": "Guides"
      },
      {
       "label": "All Crew Guides",
       "href": "https://citywidelv.github.io/cw-vendor-hub/#guides"
      },
      {
       "label": "Workloading and Crew Sizing",
       "href": "https://citywidelv.github.io/cw-vendor-hub/workloading.html"
      },
      {
       "label": "New Building Planner",
       "href": "https://citywidelv.github.io/cw-vendor-hub/planner.html"
      },
      {
       "label": "Choosing Your Equipment",
       "href": "https://citywidelv.github.io/cw-vendor-hub/equipment.html"
      },
      {
       "label": "Color Coding System",
       "href": "https://citywidelv.github.io/cw-vendor-hub/color-coding.html"
      },
      {
       "label": "Medical Facility Cleaning",
       "href": "https://citywidelv.github.io/cw-vendor-hub/medical.html"
      },
      {
       "label": "Clean Room Cleaning",
       "href": "https://citywidelv.github.io/cw-vendor-hub/cleanroom.html"
      },
      {
       "label": "GMP and Food Facility Cleaning",
       "href": "https://citywidelv.github.io/cw-vendor-hub/gmp.html"
      },
      {
       "ghead": "Ordering"
      },
      {
       "label": "Vendor Shop",
       "href": "https://citywidelv.github.io/cw-vendor-hub/shop/"
      },
      {
       "label": "Starter Kit Builder",
       "href": "https://citywidelv.github.io/cw-vendor-hub/kit-builder.html"
      },
      {
       "label": "Report Supplies Needed",
       "href": "https://citywidelv.github.io/cw-vendor-hub/building-supplies.html"
      },
      {
       "ghead": "Vendor Paperwork"
      },
      {
       "label": "Submit an Invoice",
       "href": "https://citywidelv.github.io/cw-vendor-hub/invoice.html"
      },
      {
       "label": "Upload Documents",
       "href": "https://citywidelv.github.io/cw-vendor-hub/upload.html"
      },
      {
       "label": "Update Vendor Profile",
       "href": "https://citywidelv.github.io/cw-vendor-hub/profile-update.html"
      },
      {
       "label": "Cleaner Roster",
       "href": "https://citywidelv.github.io/cw-vendor-hub/cleaner-roster.html"
      },
      {
       "label": "Card Authorization",
       "href": "https://citywidelv.github.io/cw-vendor-hub/card-authorization.html"
      },
      {
       "ghead": "Vendor Reporting"
      },
      {
       "label": "Work Order",
       "href": "https://citywidelv.github.io/cw-vendor-hub/work-order.html"
      },
      {
       "label": "Snow Service Report",
       "href": "https://citywidelv.github.io/cw-vendor-hub/snow-report.html"
      },
      {
       "label": "Nominate a Vendor or G.O.A.T.",
       "href": "https://citywidelv.github.io/cw-vendor-hub/nominate.html"
      }
     ]
    }
   ]
  },
  {
   "label": "Accounts & Buildings",
   "icon": "map",
   "items": [
    {
     "sub": "Account Changes (ACT & Ledger)",
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
       "label": "ACT and Ledger Documents (Admin Hub)",
       "href": "https://citywidelv.github.io/cw-admin-hub/act-document.html"
      },
      {
       "label": "Accounting Queue (Admin Hub)",
       "href": "https://citywidelv.github.io/cw-admin-hub/accounting-queue.html"
      },
      {
       "ghead": "Directory"
      },
      {
       "label": "Account Directory (Admin Hub)",
       "href": "https://citywidelv.github.io/cw-admin-hub/accounts.html"
      }
     ]
    },
    {
     "sub": "Building Info Sheets (DBIS)",
     "items": [
      {
       "label": "Sheet Library",
       "href": "building-sheets.html"
      },
      {
       "label": "New / Update a Sheet",
       "href": "building-sheet.html"
      }
     ]
    },
    {
     "sub": "Customer COI Requests",
     "items": [
      {
       "label": "Request a COI for a Customer",
       "href": "coi-request.html"
      },
      {
       "label": "COI Request Log (Admin Hub)",
       "href": "https://citywidelv.github.io/cw-admin-hub/coi-log.html"
      }
     ]
    },
    {
     "label": "Building Survey",
     "href": "https://citywidelv.github.io/BuildingSurvey/"
    },
    {
     "sub": "Accounts Map",
     "items": [
      {
       "label": "Las Vegas Accounts Map",
       "href": "https://www.google.com/maps/d/viewer?mid=1ewhUmSrFCo0--ALiJP0O1pLTbH0qlk4"
      },
      {
       "label": "Northern Nevada Accounts Map",
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
     "sub": "Night Manager Inspection",
     "items": [
      {
       "label": "Night Inspection (new page)",
       "href": "night-inspection.html",
       "tag": "New"
      },
      {
       "label": "Night Inspection Recaps (FSM view)",
       "href": "night-inspections.html"
      },
      {
       "label": "Night Inspection Jotform (old form)",
       "href": "https://form.jotform.com/233486327771060"
      },
      {
       "ghead": "Jotform submissions"
      },
      {
       "label": "Las Vegas inspections (hub view)",
       "href": "form-view.html?f=ni_lv",
       "tag": "New"
      },
      {
       "label": "Northern Nevada inspections (hub view)",
       "href": "form-view.html?f=ni_nnv",
       "tag": "New"
      },
      {
       "label": "Night Manager supply orders (hub view)",
       "href": "form-view.html?f=nm_supply"
      }
     ]
    },
    {
     "sub": "Nightly Route Outs",
     "items": [
      {
       "label": "Route Out (new page)",
       "href": "night-route.html",
       "tag": "New"
      },
      {
       "label": "Route Out Tonight (FSM view)",
       "href": "night-route.html#status"
      },
      {
       "label": "Las Vegas Route Out (old form)",
       "href": "https://form.jotform.com/241440730763149"
      },
      {
       "label": "Las Vegas Route Out Submissions (old form)",
       "href": "https://www.jotform.com/tables/241440730763149"
      },
      {
       "label": "Northern Nevada Route Out (old form)",
       "href": "https://form.jotform.com/team/253234894174059/nnv-night-manager-route-out"
      }
     ]
    },
    {
     "label": "Night Manager AI Tool",
     "href": "https://chatgpt.com/g/g-681233262c3c81918605de9bd3edf7be-city-wide-night-manager-tool"
    }
   ]
  },
  {
   "label": "Team & Admin",
   "icon": "home",
   "items": [
    {
     "sub": "Power BI Reports",
     "items": [
      {
       "label": "FSM reports and targets",
       "href": "powerbi.html#fsm"
      },
      {
       "label": "Director of Operations reports",
       "href": "powerbi.html#director"
      },
      {
       "ghead": "Open Power BI"
      },
      {
       "label": "All eleven apps",
       "href": "https://app.powerbi.com/home?experience=power-bi"
      },
      {
       "label": "Operations Dashboard explainer (Vimeo)",
       "href": "https://vimeo.com/1072632984/313ecdd885"
      }
     ]
    },
    {
     "sub": "CRM & Billing",
     "items": [
      {
       "label": "Open CW Sales CRM",
       "href": "https://gocitywide.crm.dynamics.com/main.aspx"
      },
      {
       "label": "Create a Supply Invoice",
       "href": "https://supplysales.powerappsportals.com/SignIn?ReturnUrl=%2FCustomer-Select%2F"
      },
      {
       "label": "Request a Supply Item",
       "href": "https://form.jotform.com/tjroberts/supply-item-request-for-field-sales"
      },
      {
       "label": "Create an Extra Charge",
       "href": "https://apps.powerapps.com/play/e/58e2128b-deac-e675-8cd1-7d879ca63711/a/a052bc89-2125-4efd-88e5-682f1d2dbcd0?tenantId=3b214a92-dd33-4a9c-a070-43f6783d144c&hint=a842db25-40d4-46c0-b151-6ad085ee7345&sourcetime=1756059511414&source=portal"
      }
     ]
    },
    {
     "sub": "Team",
     "items": [
      {
       "label": "Admin Hub (Business Operations)",
       "href": "https://citywidelv.github.io/cw-admin-hub/"
      },
      {
       "label": "Asana",
       "href": "https://app.asana.com/"
      },
      {
       "label": "Employee Uniforms",
       "href": "uniforms.html"
      },
      {
       "label": "ADP TotalSource",
       "href": "https://workforcenow.adp.com/"
      },
      {
       "label": "Order CW Merch",
       "href": "https://cwlv.printful.me/"
      },
      {
       "label": "Team Emails by Position (Admin Hub)",
       "href": "https://citywidelv.github.io/cw-admin-hub/team-emails.html"
      }
     ]
    },
    {
     "sub": "Form Submissions",
     "items": [
      {
       "label": "All forms (submission counts)",
       "href": "forms.html",
       "tag": "New"
      },
      {
       "ghead": "Most used"
      },
      {
       "label": "Night inspections, Las Vegas",
       "href": "form-view.html?f=ni_lv"
      },
      {
       "label": "Night inspections, Northern Nevada",
       "href": "form-view.html?f=ni_nnv"
      },
      {
       "label": "CCCNV work requests",
       "href": "form-view.html?f=cccnv_req"
      },
      {
       "label": "Handyman work orders",
       "href": "form-view.html?f=handyman_wo"
      },
      {
       "ghead": "Site checklists"
      },
      {
       "label": "Arroweye porter check-in / out",
       "href": "form-view.html?f=arroweye"
      },
      {
       "label": "Ken's Foods end of shift",
       "href": "form-view.html?f=kens_shift"
      },
      {
       "label": "Ken's Foods area cleaning",
       "href": "form-view.html?f=kens_area"
      },
      {
       "label": "Infinity Hospice IPU checklist",
       "href": "form-view.html?f=infinity"
      },
      {
       "label": "Southridge HOA porter recap",
       "href": "form-view.html?f=southridge"
      },
      {
       "ghead": "Client feedback"
      },
      {
       "label": "Sand's Kitchen feedback",
       "href": "form-view.html?f=sands"
      },
      {
       "label": "Stile Aesthetic feedback",
       "href": "form-view.html?f=stile"
      },
      {
       "ghead": "Jotform"
      },
      {
       "label": "My Forms (Jotform)",
       "href": "https://www.jotform.com/myforms/"
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
       "label": "City Wide YOU (Training)",
       "href": "https://gocitywide.docebosaas.com/pages/19/city-wide-you"
      }
     ]
    },
    {
     "sub": "Office Inventory",
     "items": [
      {
       "label": "Inventory on hand",
       "href": "inventory-onhand.html"
      },
      {
       "label": "Count the inventory",
       "href": "inventory.html"
      },
      {
       "ghead": "Movement"
      },
      {
       "label": "Receive new inventory",
       "href": "inventory-move.html#receive"
      },
      {
       "label": "Comp or issue inventory",
       "href": "inventory-move.html#issue"
      },
      {
       "label": "Enter sales",
       "href": "inventory-move.html#sale"
      },
      {
       "ghead": "Tracking"
      },
      {
       "label": "Exception report",
       "href": "inventory-onhand.html#exceptions"
      }
     ]
    },
    {
     "sub": "Supplier Ordering",
     "items": [
      {
       "label": "Order More EnvirOx",
       "href": "envirox.html"
      },
      {
       "ghead": "Supply Distributors"
      },
      {
       "label": "Brady Industries",
       "href": "https://www.bradyindustries.com/"
      },
      {
       "label": "Staples Advantage",
       "href": "https://www.staplesadvantage.com/"
      },
      {
       "label": "HD Supply Solutions",
       "href": "https://hdsupplysolutions.com/"
      },
      {
       "ghead": "Marketplaces"
      },
      {
       "label": "Amazon Business",
       "href": "https://www.amazon.com/business"
      },
      {
       "label": "City Wide Company Store",
       "href": "https://shopcitywide.mybrightsites.com/"
      }
     ]
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
   "label": "Vendor Resources",
   "href": "https://citywidelv.github.io/cw-vendor-hub/",
   "icon": "home"
  }
 ]
};
