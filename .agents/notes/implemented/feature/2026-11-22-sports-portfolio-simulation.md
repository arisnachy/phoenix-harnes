# Portfolio simulation from verified research prices

PHOENIX uses the exact-event ESPN quotation flow before simulating a two-core portfolio. The model supplies two distinct core event IDs after reviewing bilateral evidence; no bookmaker favorite or historical result selects the cores automatically.

The default simulated allocation is 30% per core single, 15% for their double, and 25% uncommitted reserve. A requested five- or six-leg ticket can use at most another 10% from the reserve only when all its quotes share the same bookmaker and are fresh and exact. Missing or mismatched quotes never become simulated committed stakes.

The four core-outcome scenarios show receipts and net effect on the whole budget; an optional long ticket is conservatively treated as lost unless every selection wins. These outcomes are not forecasts. Market prices are not model probabilities; no positive EV, correlation model, settlement, approval, or real placement is inferred.

The separate read-only sports chat tool recalculates quotes through the verified selection route rather than accepting model-authored price values.