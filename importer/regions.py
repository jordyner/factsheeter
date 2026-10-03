"""Country -> region mapping used to derive region weights from country weights.

iShares product pages publish country weights but not region weights, so regions
are computed here. Countries missing from this map land in "Other" and are
reported by the importer so the map can be extended.
"""

REGIONS = {
    "North America": [
        "United States", "Canada",
    ],
    "Latin America": [
        "Mexico", "Brazil", "Chile", "Colombia", "Peru", "Argentina", "Uruguay",
        "Panama", "Dominican Republic", "Costa Rica", "Ecuador", "Guatemala",
        "El Salvador", "Jamaica", "Paraguay", "Bermuda", "Cayman Islands",
        "Bahamas", "Puerto Rico", "Trinidad And Tobago", "Honduras", "Venezuela",
        "Virgin Islands (British)", "British Virgin Islands",
    ],
    "Europe": [
        "United Kingdom", "Ireland", "France", "Germany", "Switzerland",
        "Netherlands", "Belgium", "Luxembourg", "Austria", "Italy", "Spain",
        "Portugal", "Denmark", "Sweden", "Norway", "Finland", "Iceland",
        "Poland", "Czech Republic", "Czechia", "Hungary", "Greece", "Romania",
        "Slovenia", "Slovakia", "Slovak Republic", "Croatia", "Serbia", "Bulgaria", "Estonia",
        "Latvia", "Lithuania", "Malta", "Cyprus", "Monaco", "Liechtenstein",
        "Jersey", "Guernsey", "Isle Of Man", "Faroe Islands", "Gibraltar",
        "Ukraine", "Georgia", "Montenegro", "North Macedonia", "Albania",
        "Bosnia And Herzegovina", "Moldova", "Belarus", "Armenia", "Azerbaijan",
        "Russian Federation", "Russia", "Turkey", "Turkiye", "Kazakhstan",
        "Uzbekistan", "European Union", "Supranational",
    ],
    "Middle East & Africa": [
        "Israel", "Saudi Arabia", "United Arab Emirates", "Qatar", "Kuwait",
        "Bahrain", "Oman", "Jordan", "Lebanon", "Iraq", "Egypt", "South Africa",
        "Nigeria", "Kenya", "Morocco", "Ghana", "Angola", "Ivory Coast",
        "Cote D'Ivoire", "Cote D'Ivoire (Ivory Coast)", "Senegal", "Zambia", "Gabon", "Ethiopia", "Tunisia",
        "Mozambique", "Namibia", "Cameroon", "Benin", "Rwanda", "Mauritius",
        "Botswana", "Uganda", "Tanzania",
    ],
    "Asia Pacific": [
        "Japan", "China", "Hong Kong", "Taiwan", "Korea (South)", "South Korea",
        "Korea", "India", "Indonesia", "Malaysia", "Philippines", "Thailand",
        "Singapore", "Vietnam", "Pakistan", "Sri Lanka", "Bangladesh",
        "Mongolia", "Macau", "Australia", "New Zealand", "Papua New Guinea",
        "Fiji",
    ],
}

COUNTRY_TO_REGION = {c.lower(): r for r, cs in REGIONS.items() for c in cs}

# Non-country rows that show up in country tables (cash, derivatives, etc.).
NON_COUNTRY = {"cash and/or derivatives", "other", "cash", "derivatives"}


def region_for(country: str) -> str | None:
    """Return the region for a country label, "Cash/Other" for non-country rows, None if unknown."""
    key = country.strip().lower()
    if key in NON_COUNTRY:
        return "Cash/Other"
    return COUNTRY_TO_REGION.get(key)
