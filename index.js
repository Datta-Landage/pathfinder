import axios from "axios";
import express from "express";

const app = express();

// Helpers ------------------------------------------------------------
const pad = (n) => n.toString().padStart(2, "0");

const formatDate = (d) => {
  const date = new Date(d);
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  // Integra wants YYYYMMDD
  return `${yyyy}${mm}${dd}`;
};

const formatTime = (d) => {
  const date = new Date(d);
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  // Integra wants HHMMSS (24h)
  return `${hh}${mm}${ss}`;
};

const toMoney = (v, decimals = 2) =>
  (Number.isFinite(+v) ? +v : 0).toFixed(decimals);

// Example calc helpers (adjust to your GST logic) --------------------
const calculateItemTax = (item, payment) => {
  // If your price includes tax and you know tax %, replace this.
  // Placeholder: prorate by item's share of total-taxable.
  const lineTotal = (item.dish?.price || 0) * (item.quantity || 0);
  const totalBeforeTax =
    (payment.subTotal ?? payment.total - (payment.tax || 0)) || 0;
  if (totalBeforeTax <= 0) return 0;
  const share = lineTotal / totalBeforeTax;
  return share * (payment.tax || 0);
};

const calculateItemNetAmount = (item) => {
  // Net line amount (price * qty). If tax-inclusive, this is the gross paid.
  return (item.dish?.price || 0) * (item.quantity || 0);
};

// Main transformer ----------------------------------------------------
const transformToIntegraFormat = (payments) => {
  const LOCATION_CODE = "331670"; // default as per requirement
  const TERMINAL_ID = "01";       // default as per requirement
  const SHIFT_NO = "01";          // default as per requirement
  const OP_CUR = "INR";
  const EXCHANGE = 1;             // 1.000 in string

  const Transactions = payments.map((payment) => {
    const receiptNum =
      payment.billInvoice?.toString() || payment.posBillId || "";
    const when = payment.createdAt?.$date || payment.createdAt || payment.date;
    const RCPT_DT = formatDate(when);
    const RCPT_TM = formatTime(when);

    const TRAN_STATUS = "SALES"; // tweak if you have returns/etc.
    const PAYMENT_STATUS = "SALES";

    // Transaction-level fields
    const INV_AMT = +payment.total || 0;
    const TAX_AMT = +payment.tax || 0;
    const RET_AMT = 0; // adjust if you support returns
    const DISCOUNT =
      Number.isFinite(+payment.discount) ? +payment.discount : 0;

    // Items -> nested ItemDetail
    const ItemDetail = (payment.billItems || []).map((item) => {
      const itemTax = calculateItemTax(item, payment);
      const itemNet = calculateItemNetAmount(item);
      const itemCat =
        (Array.isArray(item.dish?.categoryIds) &&
          item.dish.categoryIds.join(",")) ||
        item.dish?.category ||
        "General";

      return {
        // Integra sample shows REC_TYPE present on first row; we can include consistently
        REC_TYPE: "G111",
        RCPT_NUM: receiptNum,
        RCPT_DT,
        ITEM_CODE: String(item.dish?.posDishId ?? item.dish?._id ?? ""),
        ITEM_NAME: String(item.dish?.name ?? "Unknown"),
        ITEM_QTY: toMoney(item.quantity ?? 0, 3), // many POS export qty with 3 decimals
        ITEM_PRICE: toMoney(item.dish?.price ?? 0, 2),
        ITEM_CAT: itemCat,
        ITEM_TAX: toMoney(itemTax, 6),            // keep higher precision if needed
        ITEM_TAX_TYPE: "I",                       // Inclusive tax (adjust if exclusive)
        ITEM_NET_AMT: toMoney(itemNet, 2),
        OP_CUR: OP_CUR,
        BC_EXCH: toMoney(EXCHANGE, 3),
        ITEM_STATUS: TRAN_STATUS,
        ITEM_DISCOUNT: toMoney(item.discount ?? 0, 2),
      };
    });

    // Payment -> nested PaymentDetail
    const PaymentDetail = [
      {
        RCPT_NUM: receiptNum,
        RCPT_DT,
        PAYMENT_NAME: String(payment.mode?.toUpperCase() || "CASH"),
        CURRENCY_CODE: OP_CUR,
        EXCHANGE_RATE: toMoney(EXCHANGE, 3),
        TENDER_AMOUNT: toMoney(INV_AMT, 2),
        OP_CUR: OP_CUR,
        BC_EXCH: toMoney(EXCHANGE, 3),
        PAYMENT_STATUS: PAYMENT_STATUS,
      },
    ];

    // Final transaction record shaped like Integra
    return {
      LOCATION_CODE: LOCATION_CODE,
      TERMINAL_ID: TERMINAL_ID,
      SHIFT_NO: SHIFT_NO,
      RCPT_NUM: receiptNum,
      RCPT_DT: RCPT_DT,
      BUSINESS_DT: RCPT_DT, // often same as RCPT_DT
      RCPT_TM: RCPT_TM,
      INV_AMT: toMoney(INV_AMT, 2),
      TAX_AMT: toMoney(TAX_AMT, 2),
      RET_AMT: toMoney(RET_AMT, 2),
      TRAN_STATUS: TRAN_STATUS,
      OP_CUR: OP_CUR,
      BC_EXCH: toMoney(EXCHANGE, 3),
      DISCOUNT: toMoney(DISCOUNT, 2),
      ItemDetail,
      PaymentDetail,
    };
  });

  return { Transactions };
};

// API endpoint
app.get("/api/transactions", async (req, res) => {
  const { from, to ,token} = req.query;
  if(!token){
   
    return  res.status(400).json({message: "Missing token"});
  }
  if(token !== "De1SeLkid8WZCKtl94ZBoZC7wZDZD"){
    return  res.status(403).json({message: "Invalid token"});
  }

  const payment = await axios.get(`http://localhost:4500/script/path_finder_test?businessId=66a25e423318398937eb87f9&from=${from}&to=${to}&token=${token}`);
  console.log("Fetched payment data:", payment.data.data);
  
 
  
  // Transform data to Integra format
  const integraData = transformToIntegraFormat(payment.data.data);
  
  // Set response header for JSON
  res.setHeader('Content-Type', 'application/json');
  
  // Return the data in required format
  res.json(integraData);
});

// Health check endpoint
app.get("/", (req, res) => {
  res.json({ 
    message: "Hipalz POS Integra API is running",
    endpoints: {
      transactions: "/api/transactions?from=YYYYMMDD&to=YYYYMMDD"
    }
  });
});

app.listen(3000, () => {
  console.log("Hipalz POS Integra API listening on port 3000!");
});