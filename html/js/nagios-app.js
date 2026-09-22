"use strict";(()=>{function T(e){return[{title:"General",links:[{label:"Home",href:"index.html"},{label:"Documentation",href:"https://go.nagios.com/nagioscore/docs",external:!0}]},{title:"Current Status",links:[{label:"Tactical Overview",href:`${e}/tac.cgi`},{label:"Map",href:`${e}/statusmap.cgi?host=all`},{label:"Hosts",href:`${e}/status.cgi?hostgroup=all&style=hostdetail`},{label:"Services",href:`${e}/status.cgi?host=all`},{label:"Host Groups",href:`${e}/status.cgi?hostgroup=all&style=overview`,children:[{label:"Summary",href:`${e}/status.cgi?hostgroup=all&style=summary`},{label:"Grid",href:`${e}/status.cgi?hostgroup=all&style=grid`}]},{label:"Service Groups",href:`${e}/status.cgi?servicegroup=all&style=overview`,children:[{label:"Summary",href:`${e}/status.cgi?servicegroup=all&style=summary`},{label:"Grid",href:`${e}/status.cgi?servicegroup=all&style=grid`}]}],extraTitle:"Problems",extraLinks:[{label:"Services",href:`${e}/status.cgi?host=all&servicestatustypes=28`},{label:"Services (Unhandled)",href:`${e}/status.cgi?host=all&type=detail&hoststatustypes=3&serviceprops=10&servicestatustypes=28`},{label:"Hosts",href:`${e}/status.cgi?hostgroup=all&style=hostdetail&hoststatustypes=12`},{label:"Hosts (Unhandled)",href:`${e}/status.cgi?hostgroup=all&style=hostdetail&hoststatustypes=12&hostprops=42`},{label:"Network Outages",href:`${e}/outages.cgi`}]},{title:"Reports",links:[{label:"Availability",href:`${e}/avail.cgi`},{label:"Trends",href:"trends.html",legacyHref:`${e}/trends.cgi`},{label:"Alerts / History",href:`${e}/history.cgi?host=all`},{label:"Alerts / Summary",href:`${e}/summary.cgi`},{label:"Histogram",href:"histogram.html",legacyHref:`${e}/histogram.cgi`},{label:"Notifications",href:`${e}/notifications.cgi?contact=all`},{label:"Event Log",href:`${e}/showlog.cgi`}]},{title:"System",links:[{label:"Comments",href:`${e}/extinfo.cgi?type=3`},{label:"Downtime",href:`${e}/extinfo.cgi?type=6`},{label:"Process Info",href:`${e}/extinfo.cgi?type=0`},{label:"Performance Info",href:`${e}/extinfo.cgi?type=4`},{label:"Scheduling Queue",href:`${e}/extinfo.cgi?type=7`},{label:"Configuration",href:`${e}/config.cgi`}]}]}function g(e){let t=document.createElement("li"),s=document.createElement("a");if(s.href=e.href,e.external&&(s.target="_blank",s.rel="noopener"),s.textContent=e.label,t.appendChild(s),e.legacyHref){t.appendChild(document.createTextNode(" "));let n=document.createElement("a");n.href=e.legacyHref,n.textContent="(Legacy)",t.appendChild(n)}if(e.children&&e.children.length>0){let n=document.createElement("ul");for(let a of e.children)n.appendChild(g(a));t.appendChild(n)}return t}function b(e,t){e.innerHTML="";let s=document.createElement("div");s.className="navbarlogo",s.innerHTML='<a href="https://www.nagios.org" target="_blank" rel="noopener"><img src="images/sblogo.png" height="39" width="140" border="0" alt="Nagios"></a>',e.appendChild(s);for(let n of T(t)){let a=document.createElement("div");a.className="navsection";let r=document.createElement("div");r.className="navsectiontitle",r.textContent=n.title,a.appendChild(r);let o=document.createElement("div");o.className="navsectionlinks";let l=document.createElement("ul");l.className="navsectionlinks";for(let c of n.links)l.appendChild(g(c));if(o.appendChild(l),a.appendChild(o),n.extraLinks&&n.extraLinks.length>0){let c=document.createElement("div");c.className="navsectionheader";let h=document.createElement("ul"),i=document.createElement("li");i.appendChild(document.createTextNode(n.extraTitle??""));let d=document.createElement("ul");for(let u of n.extraLinks)d.appendChild(g(u));i.appendChild(d),h.appendChild(i),c.appendChild(h),a.appendChild(c)}e.appendChild(a)}}function p(e){return`${window.NAGIOS_CGI_URL??""}/${e}`}async function m(e,t){let s=new URL(p(e),window.location.href);for(let[r,o]of Object.entries(t))s.searchParams.set(r,o);let n=await fetch(s.toString(),{credentials:"same-origin"});if(!n.ok)throw new Error(`${e} request failed: HTTP ${n.status}`);let a=await n.json();if(a.result.type_code!==0)throw new Error(`${e} error: ${a.result.message||a.result.type_text}`);return a.data}async function E(){return(await m("objectjson.cgi",{query:"hostlist"})).hostlist??[]}async function y(){let e=await m("objectjson.cgi",{query:"servicelist"}),t=[];for(let[s,n]of Object.entries(e.servicelist??{}))for(let a of n)t.push({hostName:s,description:a});return t}async function S(){try{return(await m("statusjson.cgi",{query:"programstatus"})).programstatus??null}catch{return null}}function w(e){let t=new URL(p("extinfo.cgi"),window.location.href);return t.searchParams.set("type","1"),t.searchParams.set("host",e),t.toString()}function N(e,t){let s=new URL(p("extinfo.cgi"),window.location.href);return s.searchParams.set("type","2"),s.searchParams.set("host",e),s.searchParams.set("service",t),s.toString()}function H(e){return e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}function C(e){let t=e.trim();if(t==="")return()=>!1;if(t.includes("*")){let n=t.split("*").map(H).join(".*"),a=new RegExp(n,"i");return r=>a.test(r)}let s=t.toLowerCase();return n=>n.toLowerCase().includes(s)}async function k(e){let t=(n,a)=>{e.innerHTML="";let r=document.createElement("img");r.src=`images/${n}.gif`,e.appendChild(r),e.appendChild(document.createTextNode(" "+a))};t("passiveonly","Checking process status...");let s=await S();if(s&&s.nagios_pid){let n=s.daemon_mode?"Daemon":"Process";t("enabled",`${n} running with PID ${s.nagios_pid}`)}else t("disabled","Not running")}function $(e,t){if(e.innerHTML="",t.length===0)return;let s=document.createElement("h3");s.textContent=`Hosts (${t.length})`,e.appendChild(s);let n=document.createElement("ul");for(let a of t){let r=document.createElement("li"),o=document.createElement("a");o.href=w(a),o.textContent=a,r.appendChild(o),n.appendChild(r)}e.appendChild(n)}function _(e,t){if(e.innerHTML="",t.length===0)return;let s=document.createElement("h3");s.textContent=`Services (${t.length})`,e.appendChild(s);let n=document.createElement("ul");for(let a of t){let r=document.createElement("li"),o=document.createElement("a");o.href=N(a.hostName,a.description),o.textContent=`${a.description} `,r.appendChild(o);let l=document.createElement("span");l.className="searchResultHost",l.textContent=`(${a.hostName})`,r.appendChild(l),n.appendChild(r)}e.appendChild(n)}function P(e,t){let s=e.querySelector("form"),n=e.querySelector("input[type=search]"),a=null,r=null,o=null;async function l(){if(!(a!==null&&r!==null))try{[a,r]=await Promise.all([E(),y()])}catch(i){o=i instanceof Error?i.message:String(i)}}async function c(){let i=n.value;if(i.trim()===""){t.hostsEl.innerHTML="",t.servicesEl.innerHTML="",t.statusEl.textContent="";return}if(t.statusEl.textContent="Searching...",await l(),o){t.statusEl.textContent=`Search unavailable: ${o}`;return}let d=C(i),u=(a??[]).filter(d),f=(r??[]).filter(v=>d(v.description)||d(v.hostName));$(t.hostsEl,u),_(t.servicesEl,f),u.length===0&&f.length===0?t.statusEl.textContent="No matches.":t.statusEl.textContent=""}s.addEventListener("submit",i=>{i.preventDefault(),c()});let h;n.addEventListener("input",()=>{window.clearTimeout(h),h=window.setTimeout(()=>void c(),200)})}function x(e){e.innerHTML=`
		<div id="mainbrandsplash">
			<div id="mainlogo"><a href="https://www.nagios.org/" target="_blank" rel="noopener"><img src="images/logofullsize.png" border="0" alt="Nagios" title="Nagios"></a></div>
			<div><span id="core-status"></span></div>
		</div>

		<div id="currentversioninfo">
			<div class="product">Nagios<sup><span style="font-size: small;">&reg;</span></sup> Core<sup><span style="font-size: small;">&trade;</span></sup></div>
			<div class="version">Version 4.4.14</div>
			<div class="releasedate">August 01, 2023</div>
			<div class="checkforupdates"><a href="https://www.nagios.org/checkforupdates/?version=4.4.14&amp;product=nagioscore" target="_blank" rel="noopener">Check for updates</a></div>
		</div>

		<div id="searchbox" class="navbarsearch">
			<form role="search">
				<fieldset>
					<legend>Search hosts &amp; services</legend>
					<input type="search" name="q" size="30" placeholder="e.g. *db* or web1" autocomplete="off">
				</fieldset>
			</form>
			<div id="searchstatus"></div>
			<div id="searchresults">
				<div id="searchresults-hosts"></div>
				<div id="searchresults-services"></div>
			</div>
		</div>

		<div id="splashboxes">
			<div id="splashrow1">
				<div id="splashbox1" class="splashbox-clear">
					<h2>Get Started</h2>
					<ul>
						<li><a href="https://go.nagios.com/nagioscore/startmonitoring" target="_blank" rel="noopener">Start monitoring your infrastructure</a></li>
						<li><a href="https://go.nagios.com/nagioscore/changelook" target="_blank" rel="noopener">Change the look and feel of Nagios</a></li>
						<li><a href="https://go.nagios.com/nagioscore/extend" target="_blank" rel="noopener">Extend Nagios with hundreds of addons</a></li>
						<li><a href="https://go.nagios.com/nagioscore/support" target="_blank" rel="noopener">Get support</a></li>
						<li><a href="https://go.nagios.com/nagioscore/training" target="_blank" rel="noopener">Get training</a></li>
						<li><a href="https://go.nagios.com/nagioscore/certification" target="_blank" rel="noopener">Get certified</a></li>
					</ul>
				</div>

				<div id="splashbox2" class="splashbox">
					<h2>Quick Links</h2>
					<ul>
						<li><a href="https://library.nagios.com" target="_blank" rel="noopener">Nagios Library</a> (tutorials and docs)</li>
						<li><a href="https://labs.nagios.com" target="_blank" rel="noopener">Nagios Labs</a> (development blog)</li>
						<li><a href="https://exchange.nagios.org" target="_blank" rel="noopener">Nagios Exchange</a> (plugins and addons)</li>
						<li><a href="https://support.nagios.com" target="_blank" rel="noopener">Nagios Support</a> (tech support)</li>
						<li><a href="https://www.nagios.com" target="_blank" rel="noopener">Nagios.com</a> (company)</li>
						<li><a href="https://www.nagios.org" target="_blank" rel="noopener">Nagios.org</a> (project)</li>
					</ul>
				</div>
			</div>
		</div>

		<div id="mainfooter">
			<div id="maincopy">
				Copyright &copy; 2010-2023 Nagios Core Development Team and Community Contributors. Copyright &copy; 1999-2009 Ethan Galstad. See the THANKS file for more information on contributors.
			</div>
			<div class="disclaimer">
				Nagios Core is licensed under the GNU General Public License and is provided AS IS with NO WARRANTY OF ANY KIND, INCLUDING THE WARRANTY OF DESIGN, MERCHANTABILITY, AND FITNESS FOR A PARTICULAR PURPOSE. Nagios, Nagios Core and the Nagios logo are trademarks, servicemarks, registered trademarks or registered servicemarks owned by Nagios Enterprises, LLC. Use of the Nagios marks is governed by the <a href="https://www.nagios.com/legal/trademarks/">trademark use restrictions</a>.
			</div>
			<div class="logos">
				<a href="https://www.nagios.org/" target="_blank" rel="noopener"><img src="images/weblogo1.png" width="102" height="47" border="0" style="padding: 0 40px 0 40px;" title="Nagios.org"></a>
				<a href="http://sourceforge.net/projects/nagios" target="_blank" rel="noopener"><img src="images/sflogo.png" width="88" height="31" border="0" alt="SourceForge.net Logo"></a>
			</div>
		</div>
	`;let t=e.querySelector("#core-status");k(t),P(e.querySelector("#searchbox"),{hostsEl:e.querySelector("#searchresults-hosts"),servicesEl:e.querySelector("#searchresults-services"),statusEl:e.querySelector("#searchstatus")})}function L(){document.title=`Nagios: ${window.location.hostname}`;let e=window.NAGIOS_CGI_URL??"",t=document.getElementById("nav");t&&b(t,e);let s=document.getElementById("dashboard");s&&x(s)}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",L):L();})();
