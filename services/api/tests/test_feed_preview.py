"""
Tests for the admin "test RSS feed" parser (parse_feed_preview).

The feed URL is fetched from an arbitrary admin-supplied address, so the XML
is untrusted: entity expansion and external entities must be rejected. Atom
feeds must yield their titles/links/dates (leaf elements are falsy in
ElementTree, which used to make `find(a) or find(b)` drop them).
Self-contained: no shared conftest.
"""

import os

for _k, _v in {
    "POSTGRES_PASSWORD": "x",
    "REDIS_PASSWORD": "",
    "MINIO_ENDPOINT": "x:1",
    "MINIO_ACCESS_KEY": "x",
    "MINIO_SECRET_KEY": "x",
    "JWT_SECRET_KEY": "x",
}.items():
    os.environ.setdefault(_k, _v)

import pytest  # noqa: E402
from defusedxml import DefusedXmlException  # noqa: E402

from src.routers.admin.feeds import parse_feed_preview  # noqa: E402

RSS = """<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>RSS Feed</title><description>RSS description</description>
  <item><title>First</title><link>https://example.com/1</link>
        <pubDate>Mon, 13 Oct 2026 10:00:00 GMT</pubDate><description>Body one</description></item>
  <item><link>https://example.com/2</link></item>
</channel></rss>"""

ATOM = """<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title><subtitle>Atom subtitle</subtitle>
  <entry><title>Entry one</title><link href="https://example.com/a"/>
         <updated>2026-10-13T10:00:00Z</updated><summary>Summary one</summary></entry>
  <entry><title>Entry two</title><link href="https://example.com/b"/>
         <published>2026-10-12T09:00:00Z</published><content>Content two</content></entry>
</feed>"""

BILLION_LAUGHS = """<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<rss version="2.0"><channel><title>&lol3;</title></channel></rss>"""

EXTERNAL_ENTITY = """<?xml version="1.0"?>
<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<rss version="2.0"><channel><title>&xxe;</title></channel></rss>"""


def test_rss_feed_is_parsed():
    title, description, items = parse_feed_preview(RSS)

    assert title == "RSS Feed"
    assert description == "RSS description"
    assert items[0] == {
        "title": "First",
        "link": "https://example.com/1",
        "published": "Mon, 13 Oct 2026 10:00:00 GMT",
        "summary": "Body one",
    }
    assert items[1]["title"] == "[No title]"


def test_atom_feed_yields_titles_links_and_dates():
    title, description, items = parse_feed_preview(ATOM)

    assert title == "Atom Feed"
    assert description == "Atom subtitle"
    assert items == [
        {"title": "Entry one", "link": "https://example.com/a",
         "published": "2026-10-13T10:00:00Z", "summary": "Summary one"},
        {"title": "Entry two", "link": "https://example.com/b",
         "published": "2026-10-12T09:00:00Z", "summary": "Content two"},
    ]


def test_items_are_capped_at_five():
    entries = "".join(f"<item><title>T{i}</title></item>" for i in range(8))
    _, _, items = parse_feed_preview(f"<rss><channel><title>x</title>{entries}</channel></rss>")

    assert [i["title"] for i in items] == ["T0", "T1", "T2", "T3", "T4"]


@pytest.mark.parametrize("payload", [BILLION_LAUGHS, EXTERNAL_ENTITY], ids=["entity-expansion", "external-entity"])
def test_unsafe_xml_is_rejected(payload):
    with pytest.raises(DefusedXmlException):
        parse_feed_preview(payload)
