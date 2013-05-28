var exec = require('child_process').exec;
var async = require('async');
var Heroku = require('heroku-api');
var fs = require('fs'),
  path = require('path');
var Handlebars = require('handlebars');

var source = fs.readFileSync(path.join(__dirname, 'template.hbs'), { encoding: 'utf8' });
var template = Handlebars.compile(source);


Handlebars.registerHelper('eq', function (string1, string2, options) {
  if(string1 == string2) {
    return options.fn(this);
  } else {
    return options.inverse(this);
  }
});

Handlebars.registerHelper('dash', function (string, options) {
  return string.replace(/\s/g, '-');
});

module.exports = function (options) {
  var github_baseurl = 'https://github.com/' + options.github;

  Handlebars.registerHelper('commit_url', function (commit) {
    return github_baseurl + '/commit/' + commit;
  });

  Handlebars.registerHelper('compare_url', function (commit1, commit2) {
    return github_baseurl + '/compare/' + commit1 + '...' + commit2;
  });

  function init_heroku(config) {
    var apps = config.apps;
    heroku = {};
    for (var key in apps) {
      if (!apps.hasOwnProperty(key)) break;
      heroku[key] = new Heroku({ api_token: config.api_token, app: apps[key] });
    }
    return heroku;
  }

  var heroku = init_heroku(options.heroku);

  var devbar;

  function respond(req, res, next, devbar) {
    res.format({
      html: function () {
        var result = template(devbar);
        res.send(result);
      },
      json: function () {
        res.send(devbar);
      }
    });

  }

  return function (req, res, next) {
    if (req.app.get('env') === 'production') return next();

    var cb = function (devbar) {
      return respond(req, res, next, devbar);
    }

    // use cached devbar but
    // dont return: we can still refresh devbar in background
    if (devbar) {
      res.locals.devbar = devbar;
      cb(devbar);
      cb = function () {}
    }

    async.series([
                 function (cb) {
      if (!heroku.staging) return cb();
      heroku.staging.releases(function (err, releases) {
        var last_release = releases.pop();
        return cb(err, last_release);
      });
    },
    function (cb) {
      if (!heroku.production) return cb();
      heroku.production.releases(function (err, releases) {
        var last_release = releases.pop();
        return cb(err, last_release);
      });
    },
    async.apply(exec, 'git rev-parse --short HEAD'),
    async.apply(exec, 'git symbolic-ref --short HEAD')
    ],
    function (err, results) {
      //if (err) { console.log(err); console.log(results); return next(); }

      devbar = {
        local: {},
        environment: req.app.get('env')
      };

      devbar.staging = results[0];
      devbar.production = results[1];
      try {
        devbar.local.commit = results[2][0].replace(/\s/g, '');
        devbar.local.branch = results[3][0].replace(/\s/g, '');
      }
      catch (e) {
        // not a git repository!
        devbar.local = null;
      }

      devbar.status = 'not deployed';

      // local, staging, production
      if (devbar.local && devbar.staging) {
        if (devbar.local.commit === devbar.staging.commit)
          devbar.status = 'deployed to staging';

        if (devbar.local.commit === devbar.production.commit)
          devbar.status = 'deployed';
      }
      // local, production
      else if (devbar.local && devbar.production) {
        if (devbar.local.commit === devbar.production.commit)
          devbar.status = 'deployed';
      }
      // staging, production
      else if (devbar.staging) {
        if (devbar.staging.commit === devbar.production.commit)
          devbar.status = 'deployed';
      }

      // diffs
      if (devbar.local) {
        devbar.local.diffs = [];
        if (devbar.local.commit !== devbar.staging.commit) {
          devbar.local.diffs.push({ env: 'staging', commit: devbar.staging.commit });
        }
        if (devbar.local.commit !== devbar.production.commit) {
          devbar.local.diffs.push({ env: 'production', commit: devbar.production.commit });
        }
      }
      if (devbar.staging) {
        devbar.staging.diffs = [];
        if (devbar.staging.commit !== devbar.production.commit) {
          devbar.staging.diffs.push({ env: 'production', commit: devbar.production.commit });
        }
      }
      devbar.github = options.github;

      cb(devbar);
    });

  }
}
