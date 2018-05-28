const SiteMapper = require('sitemapper'),   Fuse    = require('fuse.js'),   RateLimit = require('express-rate-limit'),
      express    = require('express'),      request = require('request'),   expressSanitized = require('express-sanitize-escape'),
      url        = require('url'),          cheerio = require('cheerio'),   morgan = require('morgan');

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

function summarize(result) {
    for (const match in result.matches) {
        if (match.key === "content") {
            return match.value.substring(0,
                Math.min(match.value.length, 150)
            );
        }
    }

    return result.item.content[0];
}



let sites = [
    {
        id: "lang-en",
        url: "http://192.168.1.150/en/",
    }, {
        id: "lang-cs",
        url: "http://192.168.1.150/cs/",
    }, {
        id: "lang-es",
        url: "http://192.168.1.150/es/",
    }
];

let fuseSettings = {
    shouldSort: true,
    includeMatches: true,
    threshold: 0.3,
    location: 0,
    distance: 100,
    maxPatternLength: 64,
    minMatchCharLength: 3,
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
    max: 300,
    delayMs: 0
}));

app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

app.use(morgan('combined'));

app.use(expressSanitized.middleware());

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
        limit = req.query.limit || 10,
        full = req.query.full || false;

    if (!siteId || !query) {
        return res.status(500)
            .send("Some parameters were not provided");
    }

    let site = instances[siteId];
    if (!site) {
        return res.status(404)
            .send("Could not find that site, check the id");
    }

    let results = site.fuse.search(query);

    let data = [];
    results.slice(0, parseInt(limit)).forEach(result => {
        if (full) {
            data.push({
                item: result.item,
                summary: summarize(result),
                matches: result.matches,
            });
        } else {
            data.push({
                item: {
                    title: result.item.title,
                    url: result.item.url,
                },

                summary: summarize(result),
                matches: result.matches,
            });
        }
    });

    res.status(200).json(data);
});

app.listen(port, '0.0.0.0', (err) => {
    if (err) {
        throw err;
    }

    console.log(`Server is listening on ${port}`);
});