"""Benchmark corpus: the CarbonTrace demo PDFs, optionally hidden among
look-alike documents for other suppliers (same templates, different plants,
IDs and numbers). Distractors are generated from a fixed seed, so every run
sees the same corpus.

A chunk is one PDF page (demo docs) or one half of a distractor document,
which is roughly what a page-level chunker produces.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from pathlib import Path

import pypdf


@dataclass(frozen=True)
class Chunk:
    id: str
    doc: str
    text: str


def load_demo(folder: Path) -> list[Chunk]:
    chunks = []
    for pdf in sorted(folder.glob("*.pdf")):
        for i, page in enumerate(pypdf.PdfReader(pdf).pages):
            text = (page.extract_text() or "").strip()
            if text:
                chunks.append(Chunk(f"{pdf.stem}#p{i + 1}", pdf.stem, text))
    return chunks


CITIES = ["Pune", "Nagpur", "Raipur", "Jamshedpur", "Ludhiana", "Coimbatore", "Rourkela", "Bhilai", "Vizag", "Surat",
          "Tianjin", "Tangshan", "Ningbo", "Wuxi", "Haiphong", "Iskenderun", "Izmir", "Gebze", "Busan", "Pohang",
          "Monterrey", "Saltillo", "Bursa", "Kocaeli", "Thane"]
METALS = ["Steel", "Alloy", "Forge", "Metal", "Wire", "Fastener", "Castings"]
PRODUCTS = [("Industrial steel fasteners", "7318"), ("Hot-rolled steel coils", "7208"), ("Steel wire rod", "7213"),
            ("Aluminium extrusions", "7604"), ("Steel tubes", "7306"), ("Iron castings", "7325")]
ROUTES = ["Electric arc furnace (scrap-based)", "Blast furnace - basic oxygen furnace", "Direct reduced iron - electric arc furnace",
          "Induction furnace", "Primary aluminium smelting"]
COUNTRIES = {"Pune": "India", "Nagpur": "India", "Raipur": "India", "Jamshedpur": "India", "Ludhiana": "India",
             "Coimbatore": "India", "Rourkela": "India", "Bhilai": "India", "Vizag": "India", "Surat": "India",
             "Thane": "India", "Tianjin": "China", "Tangshan": "China", "Ningbo": "China", "Wuxi": "China",
             "Haiphong": "Vietnam", "Iskenderun": "Turkey", "Izmir": "Turkey", "Gebze": "Turkey", "Bursa": "Turkey",
             "Kocaeli": "Turkey", "Busan": "South Korea", "Pohang": "South Korea", "Monterrey": "Mexico", "Saltillo": "Mexico"}
PORTS = ["Mundra", "Nhava Sheva", "Chennai", "Shanghai", "Qingdao", "Haiphong", "Mersin", "Busan", "Veracruz"]
EU_PORTS = ["Rotterdam", "Antwerp", "Hamburg", "Genoa", "Valencia"]
VESSELS = ["Atlas Meridian", "Blue Kestrel", "Silver Tide", "Northern Lark", "Coral Bay", "Amber Sun", "Iron Gale", "Jade Harbor"]
QUARTERS = [("1 Jan 2025", "31 Mar 2025"), ("1 Apr 2025", "30 Jun 2025"), ("1 Jul 2025", "30 Sep 2025"), ("1 Oct 2024", "31 Dec 2024")]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# IDs the real demo documents use; distractors must never reuse them.
RESERVED = {"0143", "0091", "0447"}


def _distractor_set(rng: random.Random, n: int) -> list[Chunk]:
    city = rng.choice(CITIES)
    plant = f"{city} {rng.choice(METALS)} Works, Unit {rng.randint(1, 9)}"
    country = COUNTRIES[city]
    product, cn = rng.choice(PRODUCTS)
    start, end = rng.choice(QUARTERS)
    num = f"{n:04d}"
    net = rng.randrange(2000, 40000, 250)
    covered = net - rng.choice([0, 0, 250, 500, 1000, 1500])
    intensity = round(rng.uniform(0.3, 2.6), 2)
    gas = rng.randrange(200, 2000, 10)
    elec = rng.randrange(5000, 60000, 100)
    road, sea = rng.randrange(60, 900, 10), rng.randrange(6000, 21000, 100)
    port, eu_port = rng.choice(PORTS), rng.choice(EU_PORTS)
    vstart = rng.choice([start, start, f"1 {MONTHS[(MONTHS.index(start.split()[1]) + 1) % 12]} {start.split()[2]}"])
    docs = {
        f"invoice-{num}": [
            f"COMMERCIAL INVOICE\nInvoice No: CT-INV-2025-{num}\nDate: {rng.randint(1, 28)} {rng.choice(MONTHS)} 2025\n"
            f"Seller: {plant}, {country}\nBuyer: {rng.choice(['Nordic Metals GmbH', 'Delta Imports B.V.', 'Ferro Trade S.p.A.', 'CarbonTrace EU Importer B.V.'])}\n"
            f"Product: {product} (CN {cn})\nCountry of origin: {country}\nIncoterms: {rng.choice(['CIF', 'FOB', 'DAP'])} {eu_port}",
            f"COMMERCIAL INVOICE (continued)\nNet weight: {net:,} kg\nGross weight: {net + rng.randrange(150, 900, 10):,} kg\n"
            f"Reporting period: {start} - {end}\nPackaging: {rng.randint(10, 80)} export crates on {rng.randint(5, 40)} pallets\n"
            f"Vessel: MV {rng.choice(VESSELS)}, Voyage {rng.randint(100, 400)}{rng.choice('EW')}",
        ],
        f"declaration-{num}": [
            f"SUPPLIER EMISSIONS DECLARATION\nDeclaration reference: SED-2025-{num}\nInstallation: {plant}, {country}\n"
            f"Production route: {rng.choice(ROUTES)}\nReporting period: {start} - {end}\nCovered quantity: {covered:,} kg\n"
            f"Methodology: {rng.choice(['Actual data (installation-specific)', 'Default values', 'Mixed actual and default data'])}",
            f"SUPPLIER EMISSIONS DECLARATION (continued)\nDirect embedded emissions intensity: {intensity} tCO2e per tonne\n"
            f"Total direct emissions for covered quantity: {round(intensity * covered / 1000, 2)} tCO2e\n"
            f"Precursor materials: {rng.choice(['none declared for this route', 'pig iron, declared separately', 'scrap only'])}\n"
            f"Carbon price paid: {rng.choice(['not declared', f'EUR {rng.randint(5, 60)} per tonne CO2e'])}",
        ],
        f"energy-{num}": [
            f"ENERGY AND PRODUCTION REPORT\nFacility: {plant}\nElectricity consumption: {elec:,} kWh\n"
            f"Grid emission factor applied ({rng.choice(['location-based average', 'supplier-specific', 'market-based'])}).",
            f"ENERGY AND PRODUCTION REPORT (continued)\nProcess fuel: {rng.choice(['natural gas', 'LPG', 'coke oven gas'])}, {gas} Nm3\n"
            f"Production period: {start} - {end}",
        ],
        f"transport-{num}": [
            f"TRANSPORT DECLARATION\nShipment reference: TD-2025-{num}\nShipment weight: {net:,} kg\n"
            f"Mode: road (factory to {port} port), then sea ({port} to {eu_port})\nDistance: {road} km road, {sea:,} km sea\n"
            f"Carrier: {rng.choice(['contracted ocean freight forwarder', 'carrier-owned fleet', 'third-party logistics provider'])}",
        ],
        f"verification-{num}": [
            f"VERIFICATION STATEMENT\nReference: VS-2025-{num}\nVerifier: {rng.choice(['Accredited Verification Body', 'EuroCert Verification', 'Nordic Assurance AB'])}\n"
            f"Verification coverage period: {vstart} - {end}\nScope: direct and indirect embedded emissions for the declared covered quantity\n"
            f"Opinion: {rng.choice(['reasonable assurance', 'limited assurance', 'reasonable assurance for the stated coverage period only'])}",
        ],
    }
    return [Chunk(f"{doc}#p{i + 1}", doc, text) for doc, pages in docs.items() for i, text in enumerate(pages)]


def build(folder: Path, size: str, seed: int = 7) -> list[Chunk]:
    """size: "small" (demo docs only) or "large" (demo docs among ~110 look-alike sets)."""
    demo = load_demo(folder)
    if size == "small":
        return demo
    rng = random.Random(seed)
    numbers = [n for n in range(100, 900) if f"{n:04d}" not in RESERVED]
    rng.shuffle(numbers)
    chunks = [c for n in numbers[:110] for c in _distractor_set(rng, n)]
    # Demo pages land in the middle of the corpus, where long-context models do worst.
    mid = len(chunks) // 2
    return chunks[:mid] + demo + chunks[mid:]
