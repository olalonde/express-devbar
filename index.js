var exec = require('child_process').exec;
var async = require('async');
var Heroku = require('heroku-api');

module.exports = function (config) {

  function init_heroku(config) {
    var apps = config.apps;
    heroku = {};
    for (var key in apps) {
      if (!apps.hasOwnProperty(key)) break;
      heroku[key] = new Heroku({ api_token: config.api_token, app: apps[key] });
    }
    return heroku;
  }

  var heroku = init_heroku(config);

  var devbar;

  function respond(req, res, next, devbar) {
    res.format({
      json: function () {
        res.send(devbar);
      },
      html: function () {
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
      else if (devbar.local) {
        if (devbar.local.commit === devbar.production.commit)
          devbar.status = 'deployed';
      }
      // staging, production
      else {
        if (devbar.staging.commit === devbar.production.commit)
          devbar.status = 'deployed';
      }

      cb(devbar);
    });

  }
}
