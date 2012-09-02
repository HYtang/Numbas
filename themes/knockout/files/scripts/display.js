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

Numbas.queueScript('scripts/display.js',['controls','math','xml','util','timing','jme','jme-display'],function() {

ko.bindingHandlers.fadeVisible = {
	init: function(element, valueAccessor) {
		var value = ko.utils.unwrapObservable(valueAccessor());
		$(element).toggle(value);
	},
	update: function(element, valueAccessor) {
		var value = ko.utils.unwrapObservable(valueAccessor());
		if(value)
			$(element).fadeIn();
		else
			$(element).fadeOut();
	}
};

ko.bindingHandlers.append = {
	update: function(element,valueAccessor) {
		var value = ko.utils.unwrapObservable(valueAccessor());
		$(element).html('').append(value);
	}
};

ko.bindingHandlers.mathjax = {
	update: function(element) {
		MathJax.Hub.Queue(['Typeset',MathJax.Hub,element]);
	}
}

var display = Numbas.display = {
	// update progress bar when loading
	showLoadProgress: function()
	{
		var p= 100 * Numbas.schedule.completed / Numbas.schedule.total;
		$('#progressbar #completed').width(p+'%');
	},

	//display code to be called before anything else has happened
	init: function()
	{
		this.exam = Numbas.exam.display
		this.exam.init();
		ko.applyBindings(this);

		$('#loading').hide();
		$('#everything').show();
	},

	//alert / confirm boxes
	//
	showAlert: function(msg) {
		$.prompt(msg);
	},

	showConfirm: function(msg,fnOK,fnCancel) {
		fnOK = fnOK || function(){};
		fnCancel = fnCancel || function(){};
		$.prompt(msg,{overlayspeed: 'fast', buttons:{Ok:true,Cancel:false},callback: function(val){ val ? fnOK() : fnCancel(); }});
	},
};

function Action() {
}

//display properties of exam object
display.ExamDisplay = function(e) 
{
	this.e=e;
	var ed = this;

	this.mode = ko.observable('entry');
	this.view = ko.observable('frontpage');

	this.name = ko.observable('');
	this.mark = ko.observable(0);
	this.score = ko.observable(0);
	this.percentPass = ko.observable();
	this.percentScore = ko.computed(function() {
		return Math.round(100*ed.score()/ed.mark());
	});
	this.passed = ko.computed(function() {
		return ed.percentScore()>ed.percentPass();
	});
	this.totalQuestions = ko.observable(0);
	this.allQuestions = ko.observable(true);
	this.selectQuestions = ko.observable(0);
	this.shuffleQuestions = ko.observable(false);
	this.currentQuestion = ko.observable();
	this.questions = ko.observableArray([]);
	this.allowRegen = ko.observable(false),
	this.allowReverse = ko.observable(false),
	this.allowBrowse = ko.observable(false),
	this.onAdvance = new Action(),
	this.onReverse = new Action(),
	this.onMove = new Action()
	this.duration = ko.observable(),
	this.displayDuration = ko.computed(function() {
		return Numbas.timing.secsToDisplayTime( ed.duration() );
	});
	this.timeout = new Action(),
	this.timedWarning = new Action(),
	this.stopwatch = ko.computed(function() {}),
	this.timeRemaining = ko.computed(function() {}),
	this.timeSpent = ko.observable(0),
	this.inProgress = ko.observable(false)
	this.showActualMark = ko.observable(false),
	this.showTotalMark = ko.observable(false),
	this.showAnswerState = ko.observable(false),
	this.allowRevealAnswer = ko.observable(false),
	this.adviceThreshold = ko.observable(false)
}
display.ExamDisplay.prototype = 
{
	e:undefined,	//reference to main exam object

	init: function() {
		var e = this.e;
		this.name(e.name);
		this.mark(e.mark);
		this.score(e.score);
		this.percentPass(e.percentPass);
		this.totalQuestions(e.totalQuestions);
		this.allQuestions(e.allQuestions);
		this.selectQuestions(e.selectQuestions);
		this.shuffleQuestions(e.shuffleQuestions);
		this.questions(e.questionList.map(function(q){ return q.display }));

		this.allowRegen(e.allowRegen);
		this.allowReverse(e.navigateReverse);
		this.allowBrowse(e.navigateBrowse);
		//FILL IN actions
		
		this.duration(e.duration);
		//FILL IN actions
		
		this.showActualMark(e.showActualMark);
		this.showTotalMark(e.showTotalMark);
		this.showAnswerState(e.showAnswerState);
		this.allowRevealAnswer(e.allowRevealAnswer);
		this.adviceThreshold(e.adviceGlobalThreshold);
	},

	showTiming: function()
	{
	},

	hideTiming: function()
	{
	},

	showScore: function()
	{
	},

	showInfoPage: function(page)
	{
	},

	showQuestion: function()
	{
		this.view('question');
		this.currentQuestion(this.e.currentQuestion.display);
	},

	startRegen: function() {
	},
	
	endRegen: function() {
	}
};

//display properties of question object
display.QuestionDisplay = function(q)
{
	this.q = q;
	var qd = this;

	this.number = ko.observable(q.number);
	this.name = ko.observable(q.name);

	this.marks = ko.observable(q.marks);
	this.score = ko.observable(0);
	this.adviceThreshold = ko.observable(q.adviceThreshold);

	this.visited = ko.observable(false);
	this.answered = ko.observable(false);
	this.submitted = ko.observable(0);

	this.adviceDisplayed = ko.observable(false);
	this.revealed = ko.observable(false);

	this.parts = ko.observableArray([]);

	this.statement = ko.observable('');
	this.advice = ko.observable('');

	this.canReveal = ko.computed(function() {
		return q.exam.allowRevealAnswer && !qd.revealed();
	});

	this.parts = ko.observableArray([]);
}
display.QuestionDisplay.prototype =
{
	q: undefined,					//reference back to the main question object
	html: '',						//HTML for displaying question
	questionSelector: '',			//jQuery selector for this question's menu entry

	makeHTML: function() {
		//make html for question and advice text
		//this.html = $.xsl.transform(Numbas.xml.templates.question, this.q.xml).string;
		this.statement(this.q.statement);
		this.advice(this.q.advice);
		this.parts(this.q.parts.map(function(p){ return p.display; }));
	},

	show: function()
	{
	},

	//display Advice
	showAdvice: function( fromButton )
	{
		this.adviceDisplayed(this.q.adviceDisplayed);
	},

	revealAnswer: function()
	{
		this.revealed(this.q.revealed);
	},

	//display question score and answer state
	showScore: function()
	{
		var q = this.q;

		this.visited(q.visited);
		this.score(q.score);
		this.marks(q.marks);
		this.answered(q.answered);
		this.submitted(q.submitted);
	},

	//scroll the page to where the student caused an error
	scrollToError: function() {
	}
};

var extend = Numbas.util.extend;

//display methods for question parts
display.PartDisplay = function(p)
{
	this.p = p;

	this.path = ko.observable(p.path);
	this.prompt = ko.observable(p.prompt);
}
display.PartDisplay.prototype = 
{
	p: undefined,	//reference back to main part object

	//add a warning message
	warning: function(warning)
	{
	},

	//remove all previously displayed warnings
	removeWarnings: function()
	{
	},

	//called when part is displayed (basically when question is changed)
	//show steps if appropriate, restore answers
	show: function()
	{
	},

	//update part score display
	showScore: function(valid)
	{
	},

	//called when 'show steps' button is pressed, or coming back to a part after steps shown
	showSteps: function()
	{
	},

	//called when question displayed - fills student's last answer into inputs
	restoreAnswer: function() 
	{
	},

	//fills inputs with correct answers
	revealAnswer: function() 
	{
	}
};

//JME display code
display.JMEPartDisplay = function()
{
}
display.JMEPartDisplay.prototype =
{
	timer: undefined,		//timer for the live preview
	txt: '',
	oldtxt: '',				//last displayed preview
	oldtex: '',
	hasFocus: false,
	validEntry: true,
	showAnyway: true,

	show: function()
	{
	},

	restoreAnswer: function()
	{
	},

	revealAnswer: function() 
	{
	},
	
	//display a live preview of the student's answer typeset properly
	inputChanged: function(txt,force)
	{
	}
};
display.JMEPartDisplay = extend(display.PartDisplay,display.JMEPartDisplay,true);

//Pattern Match display code
display.PatternMatchPartDisplay = function()
{
}
display.PatternMatchPartDisplay.prototype = 
{
	show: function()
	{
	},

	restoreAnswer: function()
	{
	},

	revealAnswer: function()
	{
	}
};
display.PatternMatchPartDisplay = extend(display.PartDisplay,display.PatternMatchPartDisplay,true);

//Number Entry display code
display.NumberEntryPartDisplay = function()
{
}
display.NumberEntryPartDisplay.prototype =
{
	show: function() {
	},

	restoreAnswer: function()
	{
	},

	revealAnswer: function()
	{
	}
};
display.NumberEntryPartDisplay = extend(display.PartDisplay,display.NumberEntryPartDisplay,true);


//Multiple Response display code
display.MultipleResponsePartDisplay = function()
{
}
display.MultipleResponsePartDisplay.prototype =
{
	show: function()
	{
	},
	restoreAnswer: function()
	{
	},

	revealAnswer: function()
	{
	}
};
display.MultipleResponsePartDisplay = extend(display.PartDisplay,display.MultipleResponsePartDisplay,true);


display.GapFillPartDisplay = function()
{
}
display.GapFillPartDisplay.prototype =
{
	show: function()
	{
		for(var i=0;i<this.p.gaps.length; i++)
			this.p.gaps[i].display.show();
	},

	restoreAnswer: function()
	{
		for(var i=0;i<this.p.gaps.length; i++)
			this.p.gaps[i].display.restoreAnswer();
	},

	revealAnswer: function()
	{
		for(var i=0; i<this.p.gaps.length; i++)
			this.p.gaps[i].display.revealAnswer();
	}
};
display.GapFillPartDisplay = extend(display.PartDisplay,display.GapFillPartDisplay,true);

display.InformationPartDisplay = function()
{
}
display.InformationPartDisplay = extend(display.PartDisplay,display.InformationPartDisplay,true);


//get size of contents of an input
//from http://stackoverflow.com/questions/118241/calculate-text-width-with-javascript
$.textMetrics = function(el) {
	var h = 0, w = 0;

	var div = document.createElement('div');
	document.body.appendChild(div);
	$(div).css({
		position: 'absolute',
		left: -1000,
		top: -1000,
		display: 'none'
	});

	var val = $(el).val();
	val = val.replace(/ /g,'&nbsp;');
	$(div).html(val);
	var styles = ['font-size','font-style', 'font-weight', 'font-family','line-height', 'text-transform', 'letter-spacing'];
	$(styles).each(function() {
		var s = this.toString();
		$(div).css(s, $(el).css(s));
	});

	h = $(div).outerHeight();
	w = $(div).outerWidth();

	$(div).remove();

	var ret = {
	 height: h,
	 width: w
	};

	return ret;
}

function resizeF() {
	var w = $.textMetrics(this).width;
	$(this).width(Math.max(w+30,60)+'px');
};

//update a score feedback box
//selector - jQuery selector of element to update
//score - student's score
//marks - total marks available
//settings - object containing the following properties:
//	showTotalMark
//	showActualMark
//	showAnswerState
function showScoreFeedback(selector,answered,score,marks,settings)
{
};

function scrollTo(el)
{
	if(!(el).length)
		return;
	var docTop = $(window).scrollTop();
	var docBottom = docTop + $(window).height();
	var elemTop = $(el).offset().top;
	if((elemTop-docTop < 50) || (elemTop>docBottom-50))
		$('html,body').animate({scrollTop: $(el).offset().top-50 });
}

});

