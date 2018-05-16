const SiteMapper = require('sitemapper'),   Fuse    = require('fuse.js'),   RateLimit = require('express-rate-limit'),
      express    = require('express'),      request = require('request'),
      url        = require('url'),          cheerio = require('cheerio');

function clean(string) {
    return string
        .replace(/(\r\n|\n|\r)+/g, ' ') //Removes line breaks (all platforms)
        .replace(/^\s+|\s+$/g, '') //Removes leading and trailing whitespaces
}

function split(string) {
    return string
        .replace(/\.(?!\d)/g,'.|') //Separates sentences with vertical bars
        .split("|") //Splits a string separated by vertical bars into an array
        .map(s => clean(s)) //Cleans every single string again just in case
}

let sites = [
    {
        id: "lang-en",
        url: "http://localhost:1313/en/",
    }, {
        id: "lang-cs",
        url: "http://localhost:1313/cs/",
    }, {
        id: "lang-es",
        url: "http://localhost:1313/es/",
    }
];

let fuseSettings = {
    shouldSort: true,
    includeMatches: true,
    includeScore: true,
    threshold: 0.6,
    location: 0,
    distance: 100,
    maxPatternLength: 32,
    minMatchCharLength: 1,
    keys: [{
        name: "title",
        weight: 0.7
    }, {
        name: "content",
        weight: 0.4
    }, {
        name: "tags",
        weight: 0.5
    }]
};

const port = 3000;

const app = express();
app.use(new RateLimit({
    windowMs: 60 * 1000,
    max: 100,
    delayMs: 0
}));

const mapper = new SiteMapper();
let instances = {};

function processSite(instance) {
    let result = [];

    mapper.fetch(url.resolve(instance.url, "sitemap.xml")).then(content => {
        content.sites.forEach(async site => {
            let link = url.resolve(instance.url, site);
            await request(link, function (error, response, body) {
                if (error) {
                    throw error;
                }

                let $ = cheerio.load(body);
                if ($('.post-single').length > 0) {
                    let content = clean($('.post-content').text());
                    if (content) {
                        let data = {
                            title: clean($('.post-title').text()),
                            content: split(content),
                            url: link,
                            tags: $('.post-tags .tag').map((i, e) => {
                                return $(e).text()
                            }).get()
                        };

                        result.push(data);
                    }
                }
            });
        });

        instance.fuse = new Fuse(result, fuseSettings);
    }).catch(err => console.log(err));
}

sites.forEach(site => {
    processSite(instances[site.id] = {
        id: site.id,
        url: site.url
    });
});

app.get('/', (req, res) => {
    const siteId = req.query.id,
        query = req.query.q,
        limit = req.query.limit || 10;

    if (!siteId || !query) {
        return res.status(500)
            .send("Wrong parameters");
    }

    if (query.length < 2) {
        return res.status(500)
            .send("Too small of a search query") //Maybe remove this?
    }

    let site = instances[siteId];
    if (!site) {
        return res.status(404)
            .send("Could not find that site");
    }

    let results = site.fuse.search(query);

    let data = [];
    results.slice(0, parseInt(limit)).forEach(result => {
        data.push({
            "title": result.item.title,
            "url": result.item.url,
            "matches": result.matches
        });
    });

    res.json(data);
});

app.listen(port, (err) => {
    if (err) {
        throw err;
    }

    console.log(`Server is listening on ${port}`);
});