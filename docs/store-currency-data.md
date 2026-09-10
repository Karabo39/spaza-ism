# Currency choices

The searchable list contains 153 active tender currencies from Unicode CLDR, retrieved on 10 September 2026 from https://github.com/unicode-org/cldr-json/blob/main/cldr-json/cldr-core/supplemental/currencyData.json. Country and currency names use the runtime’s English Intl.DisplayNames data. The Unicode license is included with the list in src/lib/currencies.LICENSE.txt.

Currency choices belong to individual stores. Existing stores are backfilled from the business currency, without converting any amount. Choose another currency before adding products, customers, transfers or financial activity. Once a store has such records its currency is locked: changing a symbol is not an exchange-rate conversion. This avoids mixing currencies in old statements and reports. A different currency needs a new store; automatic currency conversion and repricing are not provided.
