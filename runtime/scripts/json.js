/*
Copyright 2011 Newcastle University

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/


Numbas.queueScript('scripts/json.js',[],function() {
	Numbas.json = {

		tryLoad: function(path,to,obj)
		//returns a function which tries to load the property with given name from the path (relative to the json object) into the object 'to'
		//if 'to' is not given, the exam object is used
		//'path' uses dots as separators
		//if path doesn't exist, fail silently
		{
			if(path)
			{
				var bits = path.split('.');
				for(var i=0;i<bits.length;i++)
				{
					if(!(bits[i] in obj))		//silently fail
					{
						Numbas.debug("can't find path "+bits.slice(0,i+1).join('.'),true);
						return function(){};
					}

					if(bits[i].length)
						obj = obj[bits[i]];
				}
			}
			return function(name)
			{
				if(name in obj)
					to[name] = obj[name];
			};
		}
	};
});
