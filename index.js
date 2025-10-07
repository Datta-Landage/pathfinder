const express = require("express");
const axios = require("axios");
const app = express();

// Middleware
app.use(express.json());

// Helpers ------------------------------------------------------------
const pad = (n) => n.toString().padStart(2, "0");

const formatDate = (d) => {
  const date = new Date(d);
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  return `${yyyy}-${mm}-${dd}`; // YYYY-MM-DD
};

const formatTime = (d) => {
  const date = new Date(d);
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${hh}-${mm}-${ss}`; // HHMMSS
};

const toMoney = (v, decimals = 2) =>
  (Number.isFinite(+v) ? +v : 0).toFixed(decimals);

const calculateItemTax = (item, payment) => {
  const lineTotal = (item.dish?.price || 0) * (item.quantity || 0);
  const totalBeforeTax =
    (payment.subTotal ?? payment.total - (payment.tax || 0)) || 0;
  if (totalBeforeTax <= 0) return 0;
  const share = lineTotal / totalBeforeTax;
  return share * (payment.tax || 0);
};

const calculateItemNetAmount = (item) => {
  return (item.dish?.price || 0) * (item.quantity || 0);
};

// Transformer --------------------------------------------------------
const transformToIntegraFormat = (payments) => {
  const LOCATION_CODE = "331670";
  const TERMINAL_ID = "01";
  const SHIFT_NO = "01";
  const OP_CUR = "INR";
  const EXCHANGE = 1;

  const Transactions = payments.map((payment) => {
    const receiptNum =
      payment.billInvoice?.toString() || payment.posBillId || "";
    const when = payment.createdAt?.$date || payment.createdAt || payment.date;
    const RCPT_DT = formatDate(when);
    const RCPT_TM = formatTime(when);

    const TRAN_STATUS = "SALES";
    const PAYMENT_STATUS = "SALES";
    const INV_AMT = +payment.total || 0;
    const TAX_AMT = +payment.tax || 0;
    const SERVICE_CHARGE_AMT = payment.serviceCharge || 0;
    const RET_AMT = 0;
    const DISCOUNT = Number.isFinite(+payment.discount) ? +payment.discount : 0;

    const ItemDetail = (payment.billItems || []).map((item) => {
      const itemTax = calculateItemTax(item, payment);
      const itemNet = calculateItemNetAmount(item);
      const itemCat =
        (Array.isArray(item.dish?.categoryIds) &&
          item.dish.categoryIds.join(",")) ||
        item.dish?.category ||
        "General";

      return {
        REC_TYPE: "G111",
        RCPT_NUM: receiptNum,
        RCPT_DT,
        ITEM_CODE: String(item.dish?.posDishId ?? item.dish?._id ?? ""),
        ITEM_NAME: String(item.dish?.name ?? "Unknown"),
        ITEM_QTY: toMoney(item.quantity ?? 0, 3),
        ITEM_PRICE: toMoney(item.dish?.price ?? 0, 2),
        ITEM_CAT: itemCat,
        ITEM_TAX: toMoney(itemTax, 6),
        ITEM_TAX_TYPE: "I",
        ITEM_NET_AMT: toMoney(itemNet, 2),
        OP_CUR,
        BC_EXCH: toMoney(EXCHANGE, 3),
        ITEM_STATUS: TRAN_STATUS,
        ITEM_DISCOUNT: toMoney(item.discount ?? 0, 2),
      };
    });

    const PaymentDetail = [
      {
        RCPT_NUM: receiptNum,
        RCPT_DT,
        PAYMENT_NAME: String(payment.mode?.toUpperCase() || "CASH"),
        CURRENCY_CODE: OP_CUR,
        EXCHANGE_RATE: toMoney(EXCHANGE, 3),
        TENDER_AMOUNT: toMoney(INV_AMT, 2),
        OP_CUR,
        BC_EXCH: toMoney(EXCHANGE, 3),
        PAYMENT_STATUS,
      },
    ];

    return {
      LOCATION_CODE,
      TERMINAL_ID,
      SHIFT_NO,
      RCPT_NUM: receiptNum,
      RCPT_DT,
      BUSINESS_DT: RCPT_DT,
      RCPT_TM,
      INV_AMT: toMoney(INV_AMT, 2),
      TAX_AMT: toMoney(TAX_AMT, 2),
      RET_AMT: toMoney(RET_AMT, 2),
      SERVICE_CHARGE_AMT: toMoney(SERVICE_CHARGE_AMT, 2),
      PACKAGING_AMT: "0.00",
      DELIVERY_AMT: "0.00",
      SALE_TYPE: "DINE-IN",

      TRAN_STATUS,
      OP_CUR,
      BC_EXCH: toMoney(EXCHANGE, 3),
      DISCOUNT: toMoney(DISCOUNT, 2),
      ItemDetail,
      PaymentDetail,
    };
  });

  return { Transactions };
};

// Routes -------------------------------------------------------------
app.get("/", (req, res) => {
  res.json({
    message: "Hipalz POS Integra API is running ✅",
    endpoints: {
      transactions:
        "/api/transactions?from=YYYYMMDD&to=YYYYMMDD&token=YOUR_TOKEN",
    },
  });
});

app.get("/api/transactions", async (req, res) => {
  try {
    const { from, to, token } = req.query;

    if (!token) {
      return res.status(400).json({ message: "Missing token" });
    }
    if (token !== "De1SeLkid8WZCKtl94ZBoZC7wZDZD") {
      return res.status(403).json({ message: "Invalid token" });
    }

    const fromDate = Number(from);
    const toDate = Number(to);
    if (fromDate > toDate) {
      return res
        .status(400)
        .json({ message: "'from' date cannot be greater than 'to' date" });
    }

    const payment = await axios.get(
      `https://api.test.hipalz.com/script/path_finder_test?businessId=66a25e423318398937eb87f9&from=${from}&to=${to}&token=${token}`
    );

    const integraData = transformToIntegraFormat(payment.data.data);

    res.setHeader("Content-Type", "application/json");
    res.json(integraData);
  } catch (err) {}
});

module.exports = app;

// app.listen(3000, () => {
//   console.log("Server is running on port 3000");
// });
