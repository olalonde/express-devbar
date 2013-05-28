# Devbar

Development bar middleware that shows Git/Heroku info.

# Usage

```javascript
var devbar = require('express-devbar');
connect.use('/devbar', devbar(config));
```

Example config:

```javascript

{
  "apps": {
    "production": "appnamepro",
    "staging": "appnamestagin"
  },
    "api_token": "token..."
}

```
