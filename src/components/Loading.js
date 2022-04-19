const { Logger }			= require('@whi/weblogger');
const log				= new Logger("comp/loading");

const { load_html }			= require('../common.js');


module.exports = async function ( element_local_name, component_name ) {
    return {
	"props": {
	    "when": {
		"type": Boolean,
		"required": true,
	    },
	},
	"template": await load_html(`/dist/components/${component_name}.html`),
    };
}
