// League-wide constants. Update here once and they propagate everywhere.

export const LEAGUE_VENUE = {
  name: "OMGS Fields",
  address: "13000 S 2700 W, Riverton, UT",
  mapsUrl: "https://maps.app.goo.gl/sqhTuxaCPACSg3v67",
};

export function venueLabel(field: string): string {
  return `${field} · ${LEAGUE_VENUE.address}`;
}
