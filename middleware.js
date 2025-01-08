const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        console.log("isAuthenticated");
        return next();
    }
    res.redirect('/');
};

module.exports = { isAuthenticated };